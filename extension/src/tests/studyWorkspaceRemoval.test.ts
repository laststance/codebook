import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fsPromises, {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { RecordingStore } from '../recordingStore'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import * as captureStudyModule from '../utils/captureStudy'
import { lookAtRecording } from '../utils/lookAtRecording'
import { readProcessStart } from '../utils/readProcessStart'
import { recordingOwnerRecordPath } from '../utils/recordingOwnerRecordPath'
import { systemTrashName } from '../utils/systemTrashName'

import {
  readerSeams,
  recordedReaderHarness,
  saveOneStopNodeHistory,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { rewriteWriterRecord } from './utils/rewriteWriterRecord'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

// The product names the system Trash the way the host's operating system does; the expected texts follow it, so the suite also holds on Windows ("Recycle Bin").
const TRASH = systemTrashName()

const FULL_LIBRARY_REFUSAL =
  'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.'

/**
 * Saves one configured study into the reader's library as an earlier explained run left it, and lets the reader list it.
 * @param harness - The reader whose library receives the study.
 * @param savedAt - When the study was saved; the Saved studies list is ordered by it, newest first.
 * @example const older = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
 */
async function saveEarlierStudy(harness: Harness, savedAt: string) {
  const library = await harness.reader.learningStorage(),
    study = createConfiguredStudy(),
    runId = randomUUID()
  for (const observation of study.observations)
    observation.snapshotUri = observation.snapshotUri.replace(
      study.runId,
      runId,
    )
  study.workspaceKey = library.workspaceKey
  study.runId = runId
  study.id = `${study.instanceId}_${runId}`
  study.savedAt = savedAt
  await library.saveStudy(study)
  // Retry storage / refresh reloads the catalog the reader shows.
  await harness.reader.action('retry')
  return study
}

/** Starts one configured run on the harness's service and waits until its preparation has settled. @example const run = await startRun(harness) */
async function startRun(harness: Harness) {
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: randomUUID(),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  return { receipt, record }
}

/**
 * Sends the Saved studies section's delete request for one entry, as the Study pane does.
 * @param removalRequest - The number the pane gives this request; omitted, the request carries none.
 * @example await requestRemoval(harness, study.id)
 * @example await requestRemoval(harness, study.id, 2)
 */
function requestRemoval(
  harness: Harness,
  studyId: string,
  removalRequest?: number,
): Promise<void> {
  return readerSeams(harness).receive(
    {
      type: 'delete-study',
      revision: harness.reader.inspect().view!.revision,
      studyId,
      ...(removalRequest === undefined ? {} : { removalRequest }),
    },
    'context',
  )
}

/** Chooses one entry of Saved studies, as the Study pane's list does, and waits until the reader shows it. @example await chooseStudy(harness, study.id) */
async function chooseStudy(harness: Harness, studyId: string): Promise<void> {
  // The choice is made in the Study pane's own list, which exists only while the Study workspace is open.
  await harness.reader.open()
  await readerSeams(harness).receive(
    {
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId,
    },
    'context',
  )
  await waitUntil(
    () =>
      harness.reader.inspect().view!.model.selection.studyId === studyId &&
      !harness.reader.inspect().view!.loading,
    'the chosen saved study',
    1_000,
  )
}

/** Lists the library's saved-study files with their bytes, so a test can assert that nothing was written. @example assert.deepEqual(await studyFiles(harness), before) */
async function studyFiles(harness: Harness): Promise<[string, string][]> {
  const directory = harness.reader.inspect().libraryDirectory!
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

/**
 * Holds the reader's read of one saved study's archive until the test releases it, so a test can act while that study is still opening or while a removal reads its neighbour.
 * @param context - The test whose mocks are restored by the caller.
 * @param studyId - The saved study whose read is held; every other read answers at once.
 * @example const held = holdArchiveRead(context, chosen.id); await held.started; held.release()
 */
function holdArchiveRead(context: TestContext, studyId: string) {
  const readCheckpoint = LearningLibrary.prototype.readCheckpoint
  let entered!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    released = new Promise<void>((resolve) => {
      release = resolve
    })
  context.mock.method(
    LearningLibrary.prototype,
    'readCheckpoint',
    async function (this: LearningLibrary, id: string) {
      if (id === studyId) {
        entered()
        await released
      }
      return readCheckpoint.call(this, id)
    },
  )
  return { started, release }
}

/**
 * Makes the removal of the storage lock file fail from now on, so a removal that holds the lock cannot release it and the lock stays, as a lock does whose file the editor may not delete.
 * @param context - The test whose mocks are restored at its end.
 * @param directory - The library directory whose `writer.lock` can no longer be removed.
 * @example await refuseLockRelease(context, harness.reader.inspect().libraryDirectory!)
 */
async function refuseLockRelease(
  context: TestContext,
  directory: string,
): Promise<void> {
  const lockPath = join(await realpath(directory), 'writer.lock')
  const unlinkBefore = fsPromises.unlink
  context.mock.method(
    fsPromises,
    'unlink',
    async (...input: Parameters<typeof unlinkBefore>) => {
      if (input[0] === lockPath)
        throw Object.assign(
          new Error(`EPERM: operation not permitted, unlink '${lockPath}'`),
          { code: 'EPERM' },
        )
      return unlinkBefore(...input)
    },
  )
}

/** Sends the Saved studies list's choice of one entry without waiting for the reader to show it, as a learner does who acts again at once. @example const opening = sendChoice(harness, 'history', study.id) */
function sendChoice(
  harness: Harness,
  type: 'history' | 'node-history',
  studyId: string,
): Promise<void> {
  return readerSeams(harness).receive(
    { type, revision: harness.reader.inspect().view!.revision, studyId },
    'context',
  )
}

/**
 * Sends one message through the Study pane's webview, as the pane itself does, so the reader's reply to an open request reaches the harness.
 * It does not wait: the webview route answers nothing to its sender, so a test waits for the public outcome.
 * @param harness - The reader whose pane sends.
 * @param message - The pane message without its revision; the revision the pane has seen is added.
 * @example sendFromPane(harness, { type: 'history', studyId: study.id, openRequest: 3 })
 */
function sendFromPane(
  harness: Harness,
  message: { type: 'history' | 'node-history'; studyId: string } & Record<
    string,
    unknown
  >,
): void {
  harness.receive({
    ...message,
    revision: harness.reader.inspect().view!.revision,
  })
}

/** Names where the agent server of the reader's editor keeps the raw evidence of one run. @example evidenceDirectoryOf(harness, study) // '<storage>/agent/<instance>/<run>' */
function evidenceDirectoryOf(
  harness: Harness,
  study: { instanceId: string; runId: string },
): string {
  return join(
    harness.directory,
    'storage',
    'agent',
    study.instanceId,
    study.runId,
  )
}

// Value: protects=a run the full library refused is never written by the open reader, so it cannot take the room a learner frees; fails_when=the reader captures a refused run or reports its unsaved history as a storage failure; why_new=no workspace test ran a refused run with a reader attached; seam=none
test('a run refused on a full study library is not saved by the open reader and shows no unsaved-history line', async (context) => {
  // Arrange: the library is full at one study; every study save from here on is counted.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const saveStudy = LearningLibrary.prototype.saveStudy
    let studySaves = 0
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        studySaves++
        return saveStudy.call(this, study)
      },
    )
    const { record } = await startRun(harness)
    // Act: three reader refreshes after the refusal.
    for (let refresh = 0; refresh < 3; refresh++)
      await readerSeams(harness).refresh()
    // Assert
    assert.equal(record.error?.message, FULL_LIBRARY_REFUSAL)
    assert.equal(studySaves, 0)
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((line) => line.includes('History not saved')),
      false,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a reader refresh that arrives before the library answered the admission captures nothing; fails_when=a run is a checkpoint candidate before its admission passed, so the refused save stays queued for Retry storage; why_new=no test refreshed the reader while the admission read was pending; seam=none
test('a reader refresh while the admission of a run is still being read saves nothing and queues nothing', async (context) => {
  // Arrange: the library is full; the admission read is held until the test releases it.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const saveStudy = LearningLibrary.prototype.saveStudy
    let studySaves = 0
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        studySaves++
        return saveStudy.call(this, study)
      },
    )
    const recordings = harness.service.recordings!,
      admitsStudy = recordings.admitsStudy.bind(recordings)
    let releaseAdmission!: () => void
    const admissionHeld = new Promise<void>((resolve) => {
      releaseAdmission = resolve
    })
    recordings.admitsStudy = async (studyId) => {
      await admissionHeld
      return admitsStudy(studyId)
    }
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    // Act
    for (let refresh = 0; refresh < 3; refresh++)
      await readerSeams(harness).refresh()
    const savesWhileHeld = studySaves,
      queuedWhileHeld = readerSeams(harness).queuedStudyWrites()
    releaseAdmission()
    await record.preparation
    // Assert
    assert.equal(savesWhileHeld, 0)
    assert.equal(queuedWhileHeld, 0)
    assert.equal(record.error?.message, FULL_LIBRARY_REFUSAL)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the room a learner makes by raising the limit is not taken by the run that was refused; fails_when=Retry storage writes the refused run as a not-demonstrated study; why_new=no test ran Retry storage after a refused run; seam=none
test('after the limit is raised, Retry storage leaves the library exactly as it was before the refused run', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const filesBeforeRun = await studyFiles(harness)
    const { record } = await startRun(harness)
    await readerSeams(harness).refresh()
    // Act
    harness.setSavedStudyCapacity(2)
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(await studyFiles(harness), filesBeforeRun)
    assert.equal(filesBeforeRun.length, 2)
    assert.equal(record.error?.message, FULL_LIBRARY_REFUSAL)
  } finally {
    await harness.close()
  }
})

// Value: protects=an editor shutdown after a refused run does not end with a reader that could not save history; fails_when=retirement tries to checkpoint the refused run into the still-full library; why_new=no test retired the reader after a refused run; seam=none
test('retiring the reader after a refused run on a still-full library completes', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const { record } = await startRun(harness)
    await waitUntil(() => record.stopped, 'the end of the refused run')
    // Act / Assert
    await assert.doesNotReject(harness.reader.retire(harness.service))
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner is told in the pane why the run did not start, apart from storage errors, and no longer once a later run starts; fails_when=the refusal is missing, is mixed into the retryable errors, or outlives the run it describes; why_new=the refusal line is new; seam=none
test('the reader says in its own line that the last run did not start, and no longer once a later run is accepted', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    const whileRefused = harness.reader.inspect().view!
    // Act: the limit is raised and a later run is accepted.
    harness.setSavedStudyCapacity(2)
    const accepted = await startRun(harness)
    const afterAccepted = harness.reader.inspect().view!
    // Assert
    assert.equal(
      whileRefused.runRefusal,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
    assert.equal(
      whileRefused.errors.some((line) => line.includes('did not start')),
      false,
    )
    assert.equal(accepted.record.error, undefined)
    assert.equal(afterAccepted.runRefusal, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a run that fails preparation for a reason other than the admission is still kept as not demonstrated; fails_when=every failed preparation is excluded from history; why_new=the exclusion is new and must not widen; seam=none
test('a run whose runtime cannot be acquired is still saved as a not-demonstrated study', async () => {
  // Arrange: the library has room; acquiring the runtime fails.
  const harness = await workspaceHarness()
  try {
    harness.service.environment.createRuntime = async () => {
      throw new Error('Development server did not start')
    }
    const { record } = await startRun(harness)
    await waitUntil(() => record.stopped, 'the end of the failed run')
    // Act
    await harness.reader.action('retry')
    // Assert
    const library = await harness.reader.learningStorage()
    assert.deepEqual(
      (await library.list()).map((entry) => [entry.id, entry.outcome]),
      [[`${harness.service.instanceId}_${record.id}`, 'not-demonstrated']],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a destructive request is confirmed in a native dialog that names the study, and anything but the confirmation changes nothing; fails_when=the removal starts without the dialog, the dialog names another study, or Cancel leaves a status behind; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('asking to delete a saved study opens a native confirmation that names it, and cancelling moves nothing', async () => {
  // Arrange: one saved study with the fixture's fixed identity; the learner cancels the dialog.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage(),
      study = createConfiguredStudy()
    study.workspaceKey = library.workspaceKey
    await library.saveStudy(study)
    await harness.reader.action('retry')
    harness.answerWarningDialogs(async () => undefined)
    // Act
    await requestRemoval(harness, study.id)
    // Assert
    assert.deepEqual(structuredClone(harness.warningDialogs), [
      {
        title: `Move this saved study to the ${TRASH}?`,
        options: {
          modal: true,
          detail: `Repository browser study · ${new Date('2026-09-20T00:00:10.000Z').toLocaleString()} · demonstrated · 22222222\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.`,
        },
        items: [`Move to ${TRASH}`],
      },
    ])
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(harness.reader.inspect().view!.studyRemoval, undefined)
    assert.deepEqual(
      (await library.list()).map((entry) => entry.id),
      [study.id],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=after a confirmed removal the study is in the Trash, the next older study is shown and the learner reads how much room the library has; fails_when=a file is deleted permanently, the reader keeps showing the removed study, or the outcome line is lost on the next render; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a confirmed removal moves the study to the Trash, shows the next older study and reports the room in the library', async () => {
  // Arrange: three saved studies; the middle one is shown.
  const harness = await workspaceHarness()
  try {
    const oldest = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      middle = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      newest = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, middle.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const directory = harness.reader.inspect().libraryDirectory!
    // Act
    await requestRemoval(harness, middle.id)
    const afterRemoval = harness.reader.inspect().view!
    for (let refresh = 0; refresh < 3; refresh++)
      await readerSeams(harness).refresh()
    const afterRefreshes = harness.reader.inspect().view!
    await chooseStudy(harness, newest.id)
    const afterAnotherChoice = harness.reader.inspect().view!
    // Assert
    assert.deepEqual(
      harness.trashMoves.map((move) => [
        basename(move.path),
        move.path.startsWith(directory),
        structuredClone(move.options),
      ]),
      [
        [
          `${middle.id}.study.meta.v3.json`,
          true,
          { recursive: true, useTrash: true },
        ],
        [
          `${middle.id}.study.v3.json`,
          true,
          { recursive: true, useTrash: true },
        ],
      ],
    )
    assert.deepEqual(
      structuredClone(afterRemoval.studies.map((entry) => entry.id)),
      [newest.id, oldest.id],
    )
    assert.equal(afterRemoval.model.selection.studyId, oldest.id)
    assert.deepEqual(structuredClone(afterRemoval.studyRemoval), {
      status: 'moved',
      studyId: middle.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 2 of 64 saved studies.`,
    })
    assert.deepEqual(structuredClone(afterRefreshes.studyRemoval), {
      status: 'moved',
      studyId: middle.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 2 of 64 saved studies.`,
    })
    assert.equal(afterAnotherChoice.studyRemoval, undefined)
    assert.equal(
      afterRemoval.errors.some((line) => line.includes(TRASH)),
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=removing the oldest shown study shows the one before it, and removing the last study that can be opened shows none; fails_when=the reader keeps a removed study selected or jumps to an entry it cannot open; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('removing the oldest shown study shows the one before it, and removing the last study shows none', async () => {
  // Arrange: two saved studies; the older one is shown.
  const harness = await workspaceHarness()
  try {
    const older = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      newer = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, older.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, older.id)
    const afterFirst = harness.reader.inspect().view!
    await requestRemoval(harness, newer.id)
    const afterSecond = harness.reader.inspect().view!
    // Assert
    assert.equal(afterFirst.model.selection.studyId, newer.id)
    assert.equal(afterSecond.studies.length, 0)
    assert.equal(afterSecond.model.selection.studyId, undefined)
    assert.equal(afterSecond.study, undefined)
    assert.deepEqual(structuredClone(afterSecond.studyRemoval), {
      status: 'moved',
      studyId: newer.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
    })
    const library = await harness.reader.learningStorage()
    assert.equal((await library.readProgress()).selection?.studyId, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=removing an entry that is not the shown study leaves the shown study in place; fails_when=any removal moves the reader to another study; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('removing a saved study that is not the shown one keeps the shown study', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      other = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, other.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, shown.id)
    assert.equal(view.study?.id, shown.id)
    assert.deepEqual(structuredClone(view.studies.map((entry) => entry.id)), [
      shown.id,
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=after the shown study is removed the reader shows the nearest saved study it can open and passes over an entry it cannot, and shows none when only such an entry is left; fails_when=the reader selects the unopenable neighbour, or keeps a removed study selected because no neighbour could be read; why_new=the neighbour tests arrange only studies that can be opened; seam=none
test('after the shown study is removed the reader passes over a saved study that cannot be opened, and shows none when only that entry is left', async () => {
  // Arrange: three entries, newest first: the shown study, a first-format archive that cannot be opened, and an older study.
  const harness = await workspaceHarness()
  try {
    const older = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      shown = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    const unopenableStudyId = `${randomUUID()}_${randomUUID()}`,
      unopenableArchive = join(
        harness.reader.inspect().libraryDirectory!,
        `${unopenableStudyId}.study.json`,
      )
    await writeFile(unopenableArchive, 'not json')
    // The list places a first-format archive by its file time.
    const savedBetweenTheOthers = new Date('2026-09-20T00:00:02.000Z')
    await utimes(
      unopenableArchive,
      savedBetweenTheOthers,
      savedBetweenTheOthers,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, shown.id)
    const afterFirstRemoval = harness.reader.inspect().view!
    await requestRemoval(harness, older.id)
    const afterSecondRemoval = harness.reader.inspect().view!
    // Assert
    assert.deepEqual(
      structuredClone(
        afterFirstRemoval.studies.map((entry) => [entry.id, entry.metadata]),
      ),
      [
        [unopenableStudyId, 'unavailable'],
        [older.id, 'validated'],
      ],
    )
    assert.equal(afterFirstRemoval.model.selection.studyId, older.id)
    assert.equal(afterFirstRemoval.study?.id, older.id)
    assert.deepEqual(
      structuredClone(afterSecondRemoval.studies.map((entry) => entry.id)),
      [unopenableStudyId],
    )
    assert.equal(afterSecondRemoval.model.selection.studyId, undefined)
    assert.equal(afterSecondRemoval.study, undefined)
    assert.equal(afterSecondRemoval.studyRemoval?.status, 'moved')
  } finally {
    await harness.close()
  }
})

// Value: protects=the outcome line of a removal is replaced by the next request and retired when a run starts; fails_when=a stale "moved to the Trash" line stays beside a new run or a new request; why_new=the outcome line is new; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('the outcome line of a removal gives way to the next delete request and to a run that starts', async () => {
  // Arrange: two saved studies; the first removal is confirmed.
  const harness = await workspaceHarness()
  try {
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, first.id)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.studyId, first.id)
    // Act: the next request is cancelled, then a later removal is confirmed and a run starts.
    harness.answerWarningDialogs(async () => undefined)
    await requestRemoval(harness, second.id)
    const afterCancelledRequest = harness.reader.inspect().view!.studyRemoval
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, second.id)
    const afterSecondRemoval = harness.reader.inspect().view!.studyRemoval
    await startRun(harness)
    await readerSeams(harness).refresh()
    // Assert
    assert.equal(afterCancelledRequest, undefined)
    assert.equal(afterSecondRemoval?.status, 'moved')
    assert.equal(afterSecondRemoval?.studyId, second.id)
    assert.equal(harness.reader.inspect().view!.studyRemoval, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a removed study of this window's own run stays removed: nothing writes it again and nothing reports it as saved; fails_when=a refresh, Retry storage or retirement checkpoints the removed run again, or its run resource and status bar still offer saved material; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('the study of this window’s own stopped run stays removed through refreshes, Retry storage and retirement', async () => {
  // Arrange: a recorded run of this window that was stopped and saved.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    assert.deepEqual(
      (await library.list()).map((entry) => entry.id),
      [harness.studyId],
    )
    assert.equal(harness.saveStatus.visible, true)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, harness.studyId)
    for (let refresh = 0; refresh < 3; refresh++)
      await readerSeams(harness).refresh()
    await harness.reader.action('retry')
    await harness.reader.retire(harness.service)
    // Assert
    assert.deepEqual(
      harness.trashMoves.map((move) => move.path.slice(directory.length + 1)),
      [
        join('recordings.v2', harness.studyId),
        `${harness.studyId}.study.meta.v3.json`,
        `${harness.studyId}.study.v3.json`,
      ],
    )
    assert.deepEqual(await library.list(), [])
    assert.deepEqual(
      (await readdir(directory, { recursive: true })).filter((name) =>
        name.includes(harness.studyId),
      ),
      [],
    )
    const state = harness.service.state(harness.record)
    assert.equal(state.historyOutcome.status, 'unavailable')
    assert.equal(
      state.historyOutcome.reason,
      `The learner moved this saved study to the ${TRASH}.`,
    )
    assert.equal(state.recording.contextStatus, 'unavailable')
    assert.equal(harness.saveStatus.visible, false)
    await assert.rejects(harness.reader.saveLearningReplay(), {
      message:
        'No recorded Codebook session is available. Explain a real code path first.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=each state in which a study must not be removed refuses with its own sentence under the button, moves nothing and offers no Retry; fails_when=a Node history, a live run's study or an unknown entry reaches the Trash, or a refusal lands in the retryable errors; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('an unknown entry, a Node test history and the study of a run that has not stopped are each refused with their own sentence and nothing moves', async () => {
  // Arrange: a saved Node test history and a live run whose study the reader has saved.
  const harness = await workspaceHarness()
  try {
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the live run',
      2_000,
    )
    const unknownStudyId = `${randomUUID()}_${randomUUID()}`
    // Act
    await requestRemoval(harness, unknownStudyId)
    const unknown = harness.reader.inspect().view!.studyRemoval
    await requestRemoval(harness, nodeHistory.studyId)
    const node = harness.reader.inspect().view!.studyRemoval
    await requestRemoval(harness, liveStudyId)
    const live = harness.reader.inspect().view!
    // Assert
    assert.deepEqual(structuredClone(unknown), {
      status: 'refused',
      studyId: unknownStudyId,
      text: 'Study archive is unavailable.',
    })
    assert.deepEqual(structuredClone(node), {
      status: 'refused',
      studyId: nodeHistory.studyId,
      text: 'Node test histories cannot be deleted here yet.',
    })
    assert.deepEqual(structuredClone(live.studyRemoval), {
      status: 'refused',
      studyId: liveStudyId,
      text: 'Stop the run before deleting its study.',
    })
    assert.equal(live.unstoppedStudyId, liveStudyId)
    assert.deepEqual(harness.warningDialogs, [])
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(
      live.errors.some(
        (line) => line.includes('delet') || line.includes('unavailable.'),
      ),
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who was told to leave Recording before deleting a study and did so: the sentence is gone, and the delete button, which can be used again, stands without it; fails_when=the refusal's line is retired only by another entry or a new run, so "Choose Overview or Live to leave Recording before deleting this study." stays under the button after the learner chose Overview or Live; why_new=Cycle 0046 row 218; seam=the Study pane's tab messages
for (const tab of ['overview', 'live'] as const)
  test(`after a delete request was refused because Recording is open, choosing ${tab === 'overview' ? 'Overview' : 'Live'} retires that line`, async () => {
    // Arrange: a saved recorded run whose recording is open, and a delete request that is refused for it.
    const harness = await recordedReaderHarness()
    try {
      await harness.reader.openRecording(harness.studyId)
      await waitUntil(
        () => harness.controller.state().readiness === 'ready',
        'the opened recording',
        2_000,
      )
      await requestRemoval(harness, harness.studyId)
      const refusal = structuredClone(
        harness.reader.inspect().view!.studyRemoval,
      )
      // Act: the learner leaves Recording.
      await readerSeams(harness).receive(
        {
          type: 'tab',
          revision: harness.reader.inspect().view!.revision,
          tab,
        },
        'context',
      )
      // Assert
      const view = harness.reader.inspect().view!
      assert.deepEqual(refusal, {
        status: 'refused',
        studyId: harness.studyId,
        text: 'Choose Overview or Live to leave Recording before deleting this study.',
      })
      assert.equal(view.contentTab, tab)
      assert.equal(view.studyRemoval, undefined)
    } finally {
      await harness.close()
    }
  })

// Value: protects=the line of a removal's outcome staying while the learner only moves between Overview and Live: nothing it says has become untrue; fails_when=every tab change retires it, so a refusal the learner has just read is gone at the next look at Live; why_new=Cycle 0046 row 218 (the rule's edge: only leaving Recording retires the line); seam=the Study pane's tab messages
test('a refused delete request’s line stays when the learner changes between Overview and Live without having been in Recording', async () => {
  // Arrange: an open Study workspace on Overview, and a delete request for a saved Node test history, which is refused.
  const harness = await workspaceHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const tabTo = (tab: 'overview' | 'live'): Promise<void> =>
      readerSeams(harness).receive(
        { type: 'tab', revision: harness.reader.inspect().view!.revision, tab },
        'context',
      )
    await tabTo('overview')
    await requestRemoval(harness, nodeHistory.studyId)
    // Act
    await tabTo('live')
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.contentTab, 'live')
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'refused',
      studyId: nodeHistory.studyId,
      text: 'Node test histories cannot be deleted here yet.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=while Recording is open no study is removed, also when Recording opens while the dialog waits for its answer; fails_when=a recording that is being played loses its files, or the answer is applied to a reader that changed meanwhile; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal is refused while Recording is open, also when Recording opens while the confirmation is waiting', async () => {
  // Arrange: a saved recorded run; its recording is open.
  const harness = await recordedReaderHarness()
  try {
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    // Act: a request while Recording is open.
    await requestRemoval(harness, harness.studyId)
    const whileOpen = harness.reader.inspect().view!.studyRemoval
    const dialogsWhileOpen = harness.warningDialogs.length
    // Act again: Recording is left, the dialog opens, and Recording opens again before the learner confirms.
    await readerSeams(harness).receive(
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )
    let confirm!: (answer: string) => void
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === dialogsWhileOpen + 1,
      'the confirmation dialog',
      1_000,
    )
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the recording opened during the dialog',
      2_000,
    )
    confirm(`Move to ${TRASH}`)
    await removal
    // Assert
    assert.deepEqual(structuredClone(whileOpen), {
      status: 'refused',
      studyId: harness.studyId,
      text: 'Choose Overview or Live to leave Recording before deleting this study.',
    })
    assert.equal(dialogsWhileOpen, 0)
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyRemoval),
      {
        status: 'refused',
        studyId: harness.studyId,
        text: 'Choose Overview or Live to leave Recording before deleting this study.',
      },
    )
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a double click on the delete button opens one dialog and removes one study; fails_when=a second request while the first waits opens another dialog or starts another move; why_new=the control is new; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a second delete request while the confirmation is waiting opens no second dialog', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const cancels: (() => void)[] = []
    harness.answerWarningDialogs(
      () =>
        new Promise<string | undefined>((resolve) => {
          cancels.push((): void => resolve(undefined))
        }),
    )
    // Act
    const waiting = requestRemoval(harness, first.id)
    await waitUntil(
      () => harness.warningDialogs.length === 1,
      'the confirmation dialog',
      1_000,
    )
    const whileWaiting = harness.reader.inspect().view!.studyRemoval
    const repeated = [
      requestRemoval(harness, second.id),
      requestRemoval(harness, first.id),
    ]
    // A request that is not taken returns within the turn; one that opened a dialog would wait for its answer.
    await new Promise((resolve) => setImmediate(resolve))
    const dialogsWhileWaiting = harness.warningDialogs.length
    for (const cancel of cancels) cancel()
    await Promise.all([waiting, ...repeated])
    // Assert
    assert.deepEqual(structuredClone(whileWaiting), {
      status: 'confirming',
      studyId: first.id,
    })
    assert.equal(dialogsWhileWaiting, 1)
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(harness.reader.inspect().view!.studyRemoval, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=two delete requests that reach the reader in the same turn (two panes, or a double click whose messages the host delivers together) opening one dialog for the first study, whose state carries the first request's number; fails_when=the second request passes the one-removal check while the first still checks for a Trash, so two dialogs open and the second request's number replaces the first one's in the shared removal state; why_new=Cycle 0046 row 31 (PL-23 of Cycle 0045: the first `await` came before the removal state was reserved); seam=the editor's dialog, stubbed at the vscode boundary
test('two delete requests started in the same turn open one dialog for the first study and the second is refused while the first holds the removal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const cancels: (() => void)[] = []
    harness.answerWarningDialogs(
      () =>
        new Promise<string | undefined>((resolve) => {
          cancels.push((): void => resolve(undefined))
        }),
    )

    // Act: both requests start before either of them awaits anything.
    const firstRemoval = requestRemoval(harness, first.id, 1)
    const secondRemoval = requestRemoval(harness, second.id, 2)
    await waitUntil(
      () => harness.warningDialogs.length >= 1,
      'the confirmation dialog',
      1_000,
    )
    // A request that is not taken returns within the turn; one that was taken would open its own dialog.
    await new Promise((resolve) => setImmediate(resolve))
    const dialogsWhileWaiting = harness.warningDialogs.length
    const whileWaiting = harness.reader.inspect().view!.studyRemoval
    for (const cancel of cancels) cancel()
    await Promise.all([firstRemoval, secondRemoval])

    // Assert
    assert.equal(dialogsWhileWaiting, 1)
    assert.deepEqual(structuredClone(whileWaiting), {
      status: 'confirming',
      studyId: first.id,
      request: 1,
    })
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a study whose files are being moved can be neither opened nor played, and the pane says that the move is in progress; fails_when=a reader or an agent opens a half-moved study; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('while a saved study is being moved to the Trash it cannot be opened or played and the pane says it is moving, and the removal then completes', async () => {
  // Arrange: the Trash holds the first move of a confirmed removal.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const held = harness.holdTrashMove()
    // Act
    const removal = requestRemoval(harness, study.id)
    await held.started
    const whileMoving = harness.reader.inspect().view!.studyRemoval
    const openedRecording = harness.reader.openRecording(study.id).then(
      () => 'opened',
      (error: unknown) => String(error),
    )
    const openedHistory = readerSeams(harness)
      .readSavedArchive(study.id)
      .then(
        () => 'opened',
        (error: unknown) => String(error),
      )
    const [recordingAnswer, historyAnswer] = await Promise.all([
      openedRecording,
      openedHistory,
    ])
    held.release()
    await removal
    // Assert
    assert.deepEqual(structuredClone(whileMoving), {
      status: 'moving',
      studyId: study.id,
      text: `Moving the saved study to the ${TRASH}…`,
    })
    assert.equal(recordingAnswer, 'Error: Study archive is unavailable.')
    assert.equal(historyAnswer, 'Error: Study archive is unavailable.')
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    await harness.close()
  }
})

// Value: protects=while one saved study is on its way to the Trash a delete request for another entry opens no dialog and removes nothing; fails_when=only a waiting confirmation blocks a further request, so a second removal replaces the moving state while the first study's files are still being moved; why_new=the single-flight test repeats the request only while the dialog waits for its answer; seam=none
test('a delete request for another saved study while one is being moved to the Trash opens no dialog and leaves that study in place', async () => {
  // Arrange: two saved studies; the Trash holds the first move of the older one's confirmed removal.
  const harness = await workspaceHarness()
  try {
    const moving = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      other = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const held = harness.holdTrashMove()
    const removal = requestRemoval(harness, moving.id)
    await held.started
    // Act
    const repeated = requestRemoval(harness, other.id)
    // A request that is not taken returns within the turn; one that was taken would open its own dialog.
    await new Promise((resolve) => setImmediate(resolve))
    const dialogsWhileMoving = harness.warningDialogs.length,
      whileMoving = harness.reader.inspect().view!.studyRemoval
    held.release()
    await Promise.all([removal, repeated])
    // Assert
    const afterRemoval = harness.reader.inspect().view!
    assert.equal(dialogsWhileMoving, 1)
    assert.deepEqual(structuredClone(whileMoving), {
      status: 'moving',
      studyId: moving.id,
      text: `Moving the saved study to the ${TRASH}…`,
    })
    assert.deepEqual(
      harness.trashMoves.map((move) => basename(move.path)),
      [`${moving.id}.study.meta.v3.json`, `${moving.id}.study.v3.json`],
    )
    assert.deepEqual(
      structuredClone(afterRemoval.studies.map((entry) => entry.id)),
      [other.id],
    )
    assert.deepEqual(structuredClone(afterRemoval.studyRemoval), {
      status: 'moved',
      studyId: moving.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 1 of 64 saved studies.`,
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that fails before anything moved changes nothing: the run stays saved and keeps being saved; fails_when=the run is excluded from history although its study still exists; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal the Trash refuses at its first move deletes nothing, and a later explanation of that run is still saved', async () => {
  // Arrange: a recorded, stopped and saved run; the Trash refuses the first move, its recording, and would take every later one, so a removal that went on would leave its moves in harness.trashMoves.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.rejectTrashMoves((path) =>
      path.endsWith(join('recordings.v2', harness.studyId)),
    )
    // Act
    await requestRemoval(harness, harness.studyId)
    const afterRefusedMove = harness.reader.inspect().view!
    const snapshotUri = harness.service.state(harness.record).participants
      .browser.snapshotUri!
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'after-failed-removal',
      snapshotUri,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The theme was dark when the removal failed.',
    })
    await readerSeams(harness).refresh()
    await waitUntil(
      async () =>
        (
          await library.readStudy(harness.studyId)
        ).observations[0]!.interpretations.some(
          (interpretation) =>
            interpretation.text ===
            'The theme was dark when the removal failed.',
        ),
      'the explanation saved after the failed removal',
      2_000,
    )
    // The writer reports the checkpoint as saved only after it has read the catalog again, which follows the write on disk.
    await waitUntil(
      () =>
        harness.service.state(harness.record).historyOutcome.status === 'saved',
      'the history receipt of the explanation saved after the failed removal',
      2_000,
    )
    // Assert
    assert.deepEqual(structuredClone(afterRefusedMove.studyRemoval), {
      status: 'failed',
      studyId: harness.studyId,
      text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Trash refused ${harness.studyId}`,
    })
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(harness.saveStatus.visible, true)
    assert.equal(
      harness.service.state(harness.record).historyOutcome.status,
      'saved',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal never runs against a library another window is writing, and says so; fails_when=the lock is ignored or its refusal is reported as a partial removal; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal while another window holds the storage lock deletes nothing and names the lock', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const lock = join(
      await realpath(harness.reader.inspect().libraryDirectory!),
      'writer.lock',
    )
    await writeFile(lock, '{"pid":1}')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, study.id)
    await unlink(lock)
    // Assert
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyRemoval),
      {
        status: 'failed',
        studyId: study.id,
        text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Learning storage is locked by another writer or an interrupted session (lock file: ${lock}). No data changed; retry after resolving the lock.`,
      },
    )
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that fails in a way nobody planned for does not lock the study out for the rest of the session; fails_when=the removal state stays "moving", so the study can no longer be opened, saved or deleted; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal that fails unexpectedly leaves the study listed and deletable again', async (context) => {
  // Arrange: the library's removal throws once, which its contract never does for an expected failure.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    context.mock.method(LearningLibrary.prototype, 'removeStudy', async () => {
      throw new Error('Unexpected storage failure')
    })
    // Act
    await assert.rejects(requestRemoval(harness, study.id), {
      message: 'Unexpected storage failure',
    })
    const afterFailure = harness.reader.inspect().view!
    context.mock.restoreAll()
    await requestRemoval(harness, study.id)
    // Assert
    assert.equal(afterFailure.studyRemoval, undefined)
    assert.deepEqual(
      structuredClone(afterFailure.studies.map((entry) => entry.id)),
      [study.id],
    )
    assert.equal(harness.warningDialogs.length, 2)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a confirmation the editor fails to show leaves the saved study and the delete control as they were, so the learner can ask again; fails_when=the removal stays "confirming" after the dialog rejected, so every later delete request is ignored until the window reloads; why_new=the unexpected-failure test breaks the move, after the dialog was already answered; seam=none
test('a confirmation dialog the editor cannot show moves nothing, and the next delete request is asked and carried out', async () => {
  // Arrange: one saved study; the editor rejects the first confirmation dialog.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    harness.answerWarningDialogs(async () => {
      throw new Error('The editor could not show the dialog')
    })
    // Act
    await assert.rejects(requestRemoval(harness, study.id), {
      message: 'The editor could not show the dialog',
    })
    const afterFailedDialog = harness.reader.inspect().view!,
      movesAfterFailedDialog = harness.trashMoves.length
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, study.id)
    // Assert
    assert.equal(afterFailedDialog.studyRemoval, undefined)
    assert.deepEqual(
      structuredClone(afterFailedDialog.studies.map((entry) => entry.id)),
      [study.id],
    )
    assert.equal(movesAfterFailedDialog, 0)
    assert.equal(harness.warningDialogs.length, 2)
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyRemoval),
      {
        status: 'moved',
        studyId: study.id,
        text: `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a partly removed study stays listed and chosen, and deleting it again finishes the removal; fails_when=the half-moved study leaves the list, the reader jumps away from it, or the second removal fails on the paths that are gone; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a study the Trash took only partly stays listed and shown, and deleting it again finishes the removal', async () => {
  // Arrange: two saved studies; the Trash takes the sidecar of the shown one and refuses its archive.
  const harness = await workspaceHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      shown = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.rejectTrashMoves((path) => path.endsWith('.study.v3.json'))
    // Act
    await requestRemoval(harness, shown.id)
    const afterPartialRemoval = harness.reader.inspect().view!
    harness.rejectTrashMoves(() => false)
    await requestRemoval(harness, shown.id)
    const afterSecondRemoval = harness.reader.inspect().view!
    // Assert
    assert.deepEqual(structuredClone(afterPartialRemoval.studyRemoval), {
      status: 'failed',
      studyId: shown.id,
      text: `The saved study was only partly moved to the ${TRASH}; delete it again to finish. Trash refused ${shown.id}.study.v3.json`,
    })
    assert.deepEqual(
      structuredClone(
        afterPartialRemoval.studies.map((entry) => [entry.id, entry.metadata]),
      ),
      [
        [shown.id, 'unavailable'],
        [other.id, 'validated'],
      ],
    )
    assert.equal(afterPartialRemoval.model.selection.studyId, shown.id)
    assert.equal(afterSecondRemoval.studyRemoval?.status, 'moved')
    assert.deepEqual(
      structuredClone(afterSecondRemoval.studies.map((entry) => entry.id)),
      [other.id],
    )
    assert.equal(afterSecondRemoval.model.selection.studyId, other.id)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner is told that it is unknown whether the study moved when the removal could not look at a path after the Trash rejected it, and can delete it again; fails_when=the pane says "Nothing was deleted" for a recording that is in the Trash, or shows the line of a partly moved study as if what moved were known (AD10 case b); why_new=Cycle 0046 adversarial review AD10; seam=the editor's Trash, stubbed at the vscode boundary: before it rejects the study's recording folder, the test moves that folder away and puts a link that leads to itself where the recordings folder was, so the look afterwards answers ELOOP
test('a study whose recording folder could not be looked at after the Trash rejected it shows that Codebook could not tell whether it moved, and deleting it again finishes the removal', async () => {
  // Arrange: a saved study with an empty recording folder; the Trash takes the folder, then a link that leads to itself stands where the recordings folder was, then the call rejects.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const directory = harness.reader.inspect().libraryDirectory!
    const recordingsRoot = join(directory, 'recordings.v2'),
      recordingFolder = join(recordingsRoot, shown.id)
    await mkdir(recordingFolder, { recursive: true })
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.beforeTrashMoves(async (path) => {
      if (path !== recordingFolder) return
      await rename(path, join(harness.directory, 'moved-recording'))
      await rm(recordingsRoot, { recursive: true })
      await symlink('recordings.v2', recordingsRoot)
    })
    harness.rejectTrashMoves((path) => path === recordingFolder)
    // Act
    await requestRemoval(harness, shown.id)
    const afterUnknownMove = harness.reader.inspect().view!
    harness.beforeTrashMoves(async () => {})
    harness.rejectTrashMoves(() => false)
    await requestRemoval(harness, shown.id)
    const afterSecondRemoval = harness.reader.inspect().view!
    // Assert
    assert.deepEqual(structuredClone(afterUnknownMove.studyRemoval), {
      status: 'failed',
      studyId: shown.id,
      text: `Codebook could not tell whether the saved study was moved to the ${TRASH}; delete it again to finish. Trash refused ${shown.id}; whether ${recordingFolder} left the library could not be checked: ELOOP: too many symbolic links encountered, lstat '${recordingFolder}'`,
    })
    assert.equal(afterSecondRemoval.studyRemoval?.status, 'moved')
    assert.deepEqual(
      structuredClone(afterSecondRemoval.studies.map((entry) => entry.id)),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a checkpoint whose capture was in flight when the removal was confirmed does not bring the study back; fails_when=only the write queues are drained, which never held that capture; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a checkpoint that was capturing a study when its removal was confirmed writes nothing for it afterwards', async () => {
  // Arrange: a recorded, stopped and saved run with a captured image; the learner confirms while the next capture reads it.
  const harness = await recordedReaderHarness(true)
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    let confirm: ((answer: string) => void) | undefined
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === 1,
      'the confirmation dialog',
      1_000,
    )
    const runtime = harness.record.runtime!,
      view = runtime.view.bind(runtime)
    let capturing = false
    runtime.view = () => {
      // The capture reads the runtime again for its image; the confirmation arrives at that moment.
      if (capturing) {
        confirm?.(`Move to ${TRASH}`)
        confirm = undefined
      }
      return view()
    }
    // Act: a forced checkpoint, as Retry storage and retirement make it.
    capturing = true
    await readerSeams(harness).checkpoint(harness.service, harness.record, true)
    capturing = false
    await removal
    await readerSeams(harness).refresh()
    // Assert
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.deepEqual(await library.list(), [])
    assert.deepEqual(
      (await readdir(directory)).filter((name) =>
        name.includes(harness.studyId),
      ),
      [],
    )
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a newer checkpoint that waits behind a write in flight does not bring the study back once its removal is confirmed; fails_when=the writer picks up the waiting checkpoint after the removal started, so the study is written again behind the removal; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a checkpoint that waits behind a write in flight is not written once the removal of its study is confirmed', async (context) => {
  // Arrange: a recorded, stopped and saved run; its next study save is held, and a newer checkpoint waits behind it.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage()
    const saveStudy = LearningLibrary.prototype.saveStudy
    let studySaves = 0
    let releaseFirstSave!: () => void
    const firstSaveHeld = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        studySaves++
        if (studySaves === 1) await firstSaveHeld
        return saveStudy.call(this, study)
      },
    )
    const snapshotUri = harness.service.state(harness.record).participants
      .browser.snapshotUri!
    const explain = (key: string, interpretation: string) =>
      harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: harness.record.id,
        key,
        snapshotUri,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation,
      })
    await explain('write-in-flight', 'The first later explanation.')
    await readerSeams(harness).refresh()
    await waitUntil(() => studySaves === 1, 'the held study save', 2_000)
    await explain('waiting-checkpoint', 'The second later explanation.')
    await readerSeams(harness).refresh()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act: the learner confirms the removal while the first save is still in flight, then that save finishes.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    releaseFirstSave()
    await removal
    // Assert
    assert.equal(studySaves, 1)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.deepEqual(await library.list(), [])
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the playback position of a removed study is neither written after the removal nor left behind; fails_when=a position save queued by leaving Recording runs after the lock is released, or a later save recreates the file; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a playback position save queued before a removal settles before the first move, and none is written for the removed study afterwards', async (context) => {
  // Arrange: the recording of a saved run was opened and left, which queues its position save.
  const harness = await recordedReaderHarness()
  try {
    const directory = harness.reader.inspect().libraryDirectory!
    const order: string[] = []
    const savePreference = RecordingStore.prototype.savePreference
    let positionSaveStarted!: () => void, releasePositionSave!: () => void
    const started = new Promise<void>((resolve) => {
        positionSaveStarted = resolve
      }),
      positionSaveHeld = new Promise<void>((resolve) => {
        releasePositionSave = resolve
      })
    context.mock.method(
      RecordingStore.prototype,
      'savePreference',
      async function (
        this: RecordingStore,
        preference: Parameters<RecordingStore['savePreference']>[0],
      ) {
        // The save is held outside the storage lock until the removal has been confirmed; only a removal that waits for it lets it land first.
        positionSaveStarted()
        await positionSaveHeld
        await savePreference.call(this, preference)
        order.push('position saved')
      },
    )
    harness.rejectTrashMoves((path) => {
      order.push(`moved ${basename(path)}`)
      return false
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    await readerSeams(harness).receive(
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )
    await started
    // Act: the removal is confirmed while the position save is held, then the save is released.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const movesWhileSaveHeld = order.filter((step) =>
      step.startsWith('moved'),
    ).length
    releasePositionSave()
    await removal
    const savesBeforeLaterSave = order.filter(
      (step) => step === 'position saved',
    ).length
    await readerSeams(harness).savePlaybackPosition({
      ...harness.controller.bundle()!,
      studyId: harness.studyId,
    })
    // Assert
    assert.equal(movesWhileSaveHeld, 0)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    const firstMove = order.indexOf(`moved ${harness.studyId}`)
    assert.equal(order.slice(0, firstMove).includes('position saved'), true)
    assert.equal(order.slice(firstMove).includes('position saved'), false)
    assert.equal(order.includes('moved playback.v1.json'), true)
    assert.equal(
      order.filter((step) => step === 'position saved').length,
      savesBeforeLaterSave,
    )
    assert.equal((await readdir(directory)).includes('playback.v1.json'), false)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the playback position of a study whose removal waits for the dialog about a recording on another computer: a position save the learner causes while that dialog is open lands before the first move, and none is left behind; fails_when=the move after "Move to Trash Anyway" does not wait for the writes this window accepted while the dialog was open, so the position save runs against files on their way to the Trash (TT8, PD4); why_new=Cycle 0046 third testing review TT8: no test accepted a write while the second dialog waited; seam=the store's position save, held by the test, a recordings.v1 header of another host beside the study's own recordings.v2 recording, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a playback position save queued while the dialog about a recording on another computer is open settles before the first move after Move to Trash Anyway', async (context) => {
  // Arrange: a saved recorded run, with a recording of the same study that names old-laptop.local in an older format's folder; position saves are held until the test lets them go.
  const harness = await recordedReaderHarness()
  let releasePositionSave = (): void => {}
  try {
    const ofAnotherComputer = join(
      harness.reader.inspect().libraryDirectory!,
      'recordings.v1',
      harness.studyId,
    )
    await mkdir(ofAnotherComputer, { recursive: true })
    await writeFile(
      join(ofAnotherComputer, 'header.json'),
      JSON.stringify({
        owner: {
          pid: ID_OF_NO_PROCESS,
          hostname: 'old-laptop.local',
          sessionId: randomUUID(),
        },
        createdAt: '2026-10-01T08:00:00.000Z',
      }),
    )
    const order: string[] = []
    const savePreference = RecordingStore.prototype.savePreference
    let positionSaveStarted!: () => void
    const started = new Promise<void>((resolve) => {
        positionSaveStarted = resolve
      }),
      positionSaveHeld = new Promise<void>((resolve) => {
        releasePositionSave = resolve
      })
    context.mock.method(
      RecordingStore.prototype,
      'savePreference',
      async function (
        this: RecordingStore,
        preference: Parameters<RecordingStore['savePreference']>[0],
      ) {
        positionSaveStarted()
        await positionSaveHeld
        await savePreference.call(this, preference)
        order.push('position saved')
      },
    )
    harness.rejectTrashMoves((path) => {
      order.push(`moved ${basename(path)}`)
      return false
    })
    // While the second dialog is open the learner opens Recording and leaves it, which queues a position save.
    harness.answerWarningDialogs(async ([button]) => {
      if (button !== `Move to ${TRASH} Anyway`) return button
      await harness.reader.openRecording(harness.studyId)
      await waitUntil(
        () => harness.controller.state().readiness === 'ready',
        'the recording opened during the dialog',
        2_000,
      )
      await readerSeams(harness).receive(
        {
          type: 'tab',
          revision: harness.reader.inspect().view!.revision,
          tab: 'overview',
        },
        'context',
      )
      await started
      return button
    })

    // Act: the learner chooses Move to Trash Anyway while the position save is held, then the save is let go.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () =>
        harness.warningDialogs.length === 2 &&
        ['moving', 'moved', 'failed'].includes(
          harness.reader.inspect().view!.studyRemoval?.status ?? '',
        ),
      'the removal after Move to Trash Anyway',
      4_000,
    )
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const movesWhileSaveHeld = order.filter((step) =>
      step.startsWith('moved'),
    ).length
    releasePositionSave()
    await removal

    // Assert
    const firstMove = order.indexOf(`moved ${harness.studyId}`)
    assert.deepEqual(
      {
        movesWhileSaveHeld,
        studyRemoval: harness.reader.inspect().view!.studyRemoval?.status,
        savedBeforeTheFirstMove: order
          .slice(0, firstMove)
          .includes('position saved'),
        savedAfterIt: order.slice(firstMove).includes('position saved'),
      },
      {
        movesWhileSaveHeld: 0,
        studyRemoval: 'moved',
        savedBeforeTheFirstMove: true,
        savedAfterIt: false,
      },
    )
  } finally {
    // A save still held would keep the window from closing.
    releasePositionSave()
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a learner who reads a recording is not shown the line of a later run that did not start as if it belonged to that recording; fails_when=the refusal line stays in the pane while a recording is open (NF-24); why_new=the line was only asserted on Overview and Live; seam=none
test('the refusal line of a run that did not start is not shown while a recording is open', async () => {
  // Arrange: a saved recorded run fills a library of one study; the next run is refused.
  const harness = await recordedReaderHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    const refusalBeforeRecording = harness.reader.inspect().view!.runRefusal
    // Act: the learner opens the recording, then leaves it for Overview.
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    const whileRecording = harness.reader.inspect().view!
    await readerSeams(harness).receive(
      { type: 'tab', revision: whileRecording.revision, tab: 'overview' },
      'context',
    )
    // Assert
    assert.equal(
      refusalBeforeRecording,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
    assert.equal(whileRecording.contentTab, 'recording')
    assert.equal(whileRecording.runRefusal, undefined)
    assert.equal(
      harness.reader.inspect().view!.runRefusal,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner who raised the limit as the refusal asked is not told any longer that the run did not start; fails_when=only a removal retires the refusal line, so it stays after the limit was raised (NF-24); why_new=nothing listened for a changed limit; seam=the editor's configuration event, fired by the harness when the test changes the setting
test('raising the saved-study limit above the saved count retires the refusal line; a limit that leaves the library full keeps it', async (context) => {
  // Arrange: two saved studies under a limit of one, and a run refused on that library.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(2)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.setSavedStudyCapacity(1)
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    const library = await harness.reader.learningStorage(),
      usage = context.mock.method(library, 'usage')
    // Act: the limit is raised to the saved count, which leaves the library full, then above it.
    harness.setSavedStudyCapacity(2)
    await waitUntil(
      () => usage.mock.callCount() === 1,
      'the reader’s read of the library after the first change',
      1_000,
    )
    await usage.mock.calls[0]!.result
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const refusalWhileStillFull = harness.reader.inspect().view!.runRefusal
    harness.setSavedStudyCapacity(3)
    await waitUntil(
      () => harness.reader.inspect().view!.runRefusal === undefined,
      'the retired refusal line',
      1_000,
    )
    // Assert
    assert.equal(
      refusalWhileStillFull,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
    assert.equal(harness.reader.inspect().view!.runRefusal, undefined)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the full-library dead end is open again: after the learner removes a study, the pane says so and the same request is admitted; fails_when=the admission, the removal and the room count disagree, or the stale "did not start" line stays; why_new=the three parts are otherwise tested apart; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('after a run was refused on a full library, removing a study makes room: the refusal line goes, and the same request prepares and clicks', async () => {
  // Arrange: a library full at one study and a run refused on it.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, earlier.id)
    const afterRemoval = harness.reader.inspect().view!
    const admitted = await startRun(harness)
    await harness.reader.action('click')
    // Assert
    assert.equal(refused.record.error?.message, FULL_LIBRARY_REFUSAL)
    assert.deepEqual(structuredClone(afterRemoval.studyRemoval), {
      status: 'moved',
      studyId: earlier.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 0 of 1 saved studies. Ask your editor agent to start the run again.`,
    })
    assert.equal(afterRemoval.runRefusal, undefined)
    assert.equal(admitted.record.error, undefined)
    assert.equal(admitted.record.prepared, true)
    assert.equal(harness.runtimes.at(-1)!.snapshots.length, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the "did not start" line stays while its reason still holds; fails_when=any removal clears the line although the library is still full or the limit setting is still invalid; why_new=the line and the removal are new; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('the refusal line stays after a removal that leaves the library full or the limit setting invalid', async () => {
  // Arrange: two saved studies under a limit of one, and a run refused on that full library.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(2)
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.setSavedStudyCapacity(1)
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act: one removal leaves one study under the limit of one.
    await requestRemoval(harness, first.id)
    const stillFull = harness.reader.inspect().view!
    // Arrange again: a run refused for an invalid limit setting.
    harness.setSavedStudyCapacity('many')
    const refusedForSetting = await startRun(harness)
    await waitUntil(
      () => refusedForSetting.record.stopped,
      'the end of the run refused for the setting',
    )
    // Act again
    await requestRemoval(harness, second.id)
    const stillInvalid = harness.reader.inspect().view!
    // Assert
    assert.equal(
      stillFull.studyRemoval?.text,
      `Saved study moved to the ${TRASH}. The library now holds 1 of 1 saved studies and is still full; delete 1 more before another study can be saved.`,
    )
    assert.equal(
      stillFull.runRefusal,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
    assert.equal(
      stillInvalid.studyRemoval?.text,
      `Saved study moved to the ${TRASH}.`,
    )
    assert.equal(
      stillInvalid.runRefusal,
      'The last run did not start: Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to 256. Existing learning was kept.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a checkpoint that a removal held back is written as soon as that removal ended without moving anything; fails_when=the held-back entry stays unwritten until the next material change, Retry storage or retirement, so an explanation the agent committed is missing from the saved study; why_new=the held-back entry was only tested for a removal that moved the study; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a checkpoint that waited behind a write during a removal that moved nothing is written afterwards without another trigger', async (context) => {
  // Arrange: a recorded, stopped and saved run; its next study save is held, and a newer checkpoint waits behind it.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage()
    const saveStudy = LearningLibrary.prototype.saveStudy
    let studySaves = 0
    let releaseFirstSave!: () => void
    const firstSaveHeld = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        studySaves++
        if (studySaves === 1) await firstSaveHeld
        return saveStudy.call(this, study)
      },
    )
    const snapshotUri = harness.service.state(harness.record).participants
      .browser.snapshotUri!
    const explain = (key: string, interpretation: string) =>
      harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: harness.record.id,
        key,
        snapshotUri,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation,
      })
    await explain('write-in-flight', 'The first later explanation.')
    await readerSeams(harness).refresh()
    await waitUntil(() => studySaves === 1, 'the held study save', 2_000)
    await explain('waiting-checkpoint', 'The second later explanation.')
    await readerSeams(harness).refresh()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // The Trash refuses only the first move, the recording: the stub records no refused move, so a removal that went on is seen by the later moves it would record.
    harness.rejectTrashMoves((path) =>
      path.endsWith(join('recordings.v2', harness.studyId)),
    )
    // Act: the learner confirms while the first save is in flight; the Trash then refuses the first move.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    releaseFirstSave()
    await removal
    // Assert: no refresh, Retry storage or retirement follows the removal.
    await waitUntil(
      () =>
        harness.service.state(harness.record).historyOutcome.status === 'saved',
      'the held-back checkpoint written after the removal',
      2_000,
    )
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'failed')
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(studySaves, 2)
    assert.deepEqual(
      (
        await library.readStudy(harness.studyId)
      ).observations[0]!.interpretations.map(
        (interpretation) => interpretation.text,
      ).filter((text) => text.endsWith('later explanation.')),
      ['The first later explanation.', 'The second later explanation.'],
    )
    // The writer reports "saved" before it saves the recording context and drops its entry.
    await waitUntil(
      () => readerSeams(harness).queuedStudyWrites() === 0,
      'the written checkpoint leaving the queue',
      2_000,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a reader that is retired while a removal is in progress still saves the run's final state when that removal moves nothing; fails_when=the final checkpoint skips the study because it is moving, so the last explanation is lost when the window closes; why_new=retirement was only tested after a removal had ended; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('retiring the reader during a removal that moves nothing waits for it and saves the final state of the run', async () => {
  // Arrange: a recorded, stopped and saved run with one explanation the reader has not saved yet; the Trash holds, then refuses, the first move.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage()
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'before-retirement',
      snapshotUri: harness.service.state(harness.record).participants.browser
        .snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Explained right before the window closed.',
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.rejectTrashMoves(() => true)
    const held = harness.holdTrashMove()
    const removal = requestRemoval(harness, harness.studyId)
    await held.started
    // Act
    let retired = false
    const retirement = harness.reader.retire(harness.service).then(() => {
      retired = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const retiredWhileMoving = retired
    held.release()
    await removal
    await retirement
    // Assert
    assert.equal(retiredWhileMoving, false)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'failed')
    assert.equal(
      (
        await library.readStudy(harness.studyId)
      ).observations[0]!.interpretations.some(
        (interpretation) =>
          interpretation.text === 'Explained right before the window closed.',
      ),
      true,
    )
    assert.equal(
      harness.service.state(harness.record).historyOutcome.status,
      'saved',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a reader retired while a study is on its way to the Trash never writes that study back; fails_when=the final checkpoint that now waits for the move goes on to save a study the move took; why_new=the forced checkpoint used to skip a moving study and now waits for it; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('retiring the reader during a removal that moves the study waits for it and writes nothing for that study', async () => {
  // Arrange: a recorded, stopped and saved run with one unsaved explanation; the Trash holds its first move.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'before-retirement',
      snapshotUri: harness.service.state(harness.record).participants.browser
        .snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Explained right before the window closed.',
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const held = harness.holdTrashMove()
    const removal = requestRemoval(harness, harness.studyId)
    await held.started
    // Act
    let retired = false
    const retirement = harness.reader.retire(harness.service).then(() => {
      retired = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const retiredWhileMoving = retired
    held.release()
    await removal
    await retirement
    // Assert
    assert.equal(retiredWhileMoving, false)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.deepEqual(await library.list(), [])
    assert.deepEqual(
      (await readdir(directory)).filter((name) =>
        name.includes(harness.studyId),
      ),
      [],
    )
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=Save learning replay pressed during a removal answers at once and the removal finishes; fails_when=the save starts, waits for the removal, and the removal waits for the save, so neither ends; why_new=a forced checkpoint now waits for the move, and the move waits for a save in flight; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('Save learning replay pressed while its study is being moved to the Trash is refused and the removal completes', async () => {
  // Arrange: a recorded, stopped and saved run; the Trash holds the first move of its confirmed removal.
  const harness = await recordedReaderHarness()
  try {
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const held = harness.holdTrashMove()
    const removal = requestRemoval(harness, harness.studyId)
    await held.started
    // Act
    const saveAnswer = await harness.reader
      .saveLearningReplay(harness.studyId)
      .then(
        () => 'saved',
        (error: unknown) => String(error),
      )
    held.release()
    await removal
    // Assert
    assert.equal(saveAnswer, 'Error: Study archive is unavailable.')
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    await harness.close()
  }
})

// Value: protects=a Save learning replay that is writing its study when the learner confirms the removal of that study ends, and the removal waits for that write and then completes; fails_when=a save that is past its checkpoint is made to wait for the move while the move waits for the save, so neither ends, or the first file moves while the save is still writing; why_new=the only save test during a removal starts the save after the move began, where it is refused at once; seam=the library's study write, held by the test
test('a Save learning replay that is writing its study when the removal is confirmed is answered as unavailable, and the removal completes after that write', async (context) => {
  // Arrange: a recorded, stopped and saved run; the study write of its Save learning replay is held.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    const saveStudy = LearningLibrary.prototype.saveStudy
    const order: string[] = []
    let releaseWrite!: () => void
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        order.push('study write started')
        await writeHeld
        await saveStudy.call(this, study)
        order.push('study write finished')
      },
    )
    harness.rejectTrashMoves((path) => {
      order.push(`moved ${basename(path)}`)
      return false
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const save = harness.reader.saveLearningReplay(harness.studyId).then(
      () => 'saved',
      (error: unknown) => String(error),
    )
    await waitUntil(
      () => order.length === 1,
      'the held study write of the save',
      2_000,
    )
    // Act: the learner confirms the removal while the save is writing; then the write finishes.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const movesWhileWriting = order.filter((step) =>
      step.startsWith('moved'),
    ).length
    releaseWrite()
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moved',
      'the removal completing after the save in flight',
      5_000,
    )
    await removal
    const saveAnswer = await save
    // Assert
    assert.equal(movesWhileWriting, 0)
    assert.deepEqual(order.slice(0, 3), [
      'study write started',
      'study write finished',
      `moved ${harness.studyId}`,
    ])
    assert.equal(saveAnswer, 'Error: Study archive is unavailable.')
    assert.equal(
      order.filter((step) => step === 'study write started').length,
      1,
    )
    assert.deepEqual(await library.list(), [])
    assert.deepEqual(
      (await readdir(directory)).filter((name) =>
        name.includes(harness.studyId),
      ),
      [],
    )
    assert.equal(harness.saveStatus.visible, false)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=when the Trash refuses the first file of a study the reader's ledger names, the learner is told that nothing was deleted and the run keeps being saved; fails_when=the ledger rewrite before that file is counted as a partial removal, so the run is dropped from history although every file of its study is still there; why_new=the refused-first-move test arranged a study whose first move is its recording; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal the Trash refuses at the first file of a study the ledger names deletes nothing and keeps the run saved and offered for Save learning replay', async () => {
  // Arrange: a recorded, stopped and saved run, chosen so the ledger names its study. Its recording directory is taken away here, because only a study without one reaches the ledger rewrite before its first file move.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    await chooseStudy(harness, harness.studyId)
    await rm(join(directory, 'recordings.v2', harness.studyId), {
      recursive: true,
    })
    const ledgerPath = join(directory, 'progress.repository.v4.json')
    const ledgerBefore = await readFile(ledgerPath, 'utf8')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // The Trash refuses only the first file, the catalog sidecar, and would take the archive: a removal that went on would leave that move in harness.trashMoves.
    harness.rejectTrashMoves((path) => path.endsWith('.study.meta.v3.json'))
    // Act
    await requestRemoval(harness, harness.studyId)
    const afterRefusedMove = harness.reader.inspect().view!
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'after-failed-removal',
      snapshotUri: harness.service.state(harness.record).participants.browser
        .snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Explained after the failed removal.',
    })
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(harness.record).historyOutcome.status === 'saved',
      'the explanation saved after the failed removal',
      2_000,
    )
    // Assert
    assert.deepEqual(structuredClone(afterRefusedMove.studyRemoval), {
      status: 'failed',
      studyId: harness.studyId,
      text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Trash refused ${harness.studyId}.study.meta.v3.json`,
    })
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(JSON.parse(ledgerBefore).selection.studyId, harness.studyId)
    assert.equal(await readFile(ledgerPath, 'utf8'), ledgerBefore)
    assert.equal(harness.record.historyExcluded, undefined)
    assert.equal(harness.saveStatus.visible, true)
    assert.equal(
      (
        await library.readStudy(harness.studyId)
      ).observations[0]!.interpretations.some(
        (interpretation) =>
          interpretation.text === 'Explained after the failed removal.',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a delete request never names the study that was shown before the one the learner just chose; fails_when=the request is taken while the chosen entry is still opening, so the dialog names the earlier study; why_new=the pane's list could fall back to the shown study while a chosen entry loaded; seam=the library's archive read, held by the test
test('a delete request while a chosen saved study is still opening is refused with its own sentence and opens no dialog', async (context) => {
  // Arrange: one study is shown; the learner chooses another, whose archive is still being read.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const held = holdArchiveRead(context, chosen.id)
    const opening = sendChoice(harness, 'history', chosen.id)
    await held.started
    // Act: the delete request still carries the shown study, as a pane that fell back to it would send.
    await requestRemoval(harness, shown.id)
    const whileOpening = harness.reader.inspect().view!.studyRemoval
    const dialogsWhileOpening = harness.warningDialogs.length
    held.release()
    await opening
    // Assert
    assert.deepEqual(structuredClone(whileOpening), {
      status: 'refused',
      studyId: shown.id,
      text: 'Wait for the chosen saved study to open.',
    })
    assert.equal(dialogsWhileOpening, 0)
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      chosen.id,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a confirmation answered after the learner chose another entry does not remove the study the dialog named while that entry is still opening; fails_when=the answer is applied without checking again whether a chosen entry is opening; why_new=the second check after the dialog did not know an opening entry; seam=the library's archive read, held by the test
test('a removal confirmed while another saved study is still opening moves nothing and says to wait', async (context) => {
  // Arrange: the confirmation of one study is waiting; meanwhile another entry is chosen and its archive is still being read.
  const harness = await workspaceHarness()
  try {
    const named = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, named.id)
    let confirm!: () => void
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, named.id)
    await waitUntil(
      () => harness.warningDialogs.length === 1,
      'the confirmation dialog',
      1_000,
    )
    const held = holdArchiveRead(context, chosen.id)
    const opening = sendChoice(harness, 'history', chosen.id)
    await held.started
    // Act
    confirm()
    await removal
    const afterAnswer = harness.reader.inspect().view!.studyRemoval
    held.release()
    await opening
    // Assert
    assert.deepEqual(structuredClone(afterAnswer), {
      status: 'refused',
      studyId: named.id,
      text: 'Wait for the chosen saved study to open.',
    })
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a delete request while a Node test history is still opening waits like one behind a saved study; fails_when=only saved studies mark themselves as opening, so the request is taken for the study shown before; why_new=a Node test history that is opening had no marker; seam=the Node history store's read, held by the test
test('a delete request while a chosen Node test history is still opening is refused with the same sentence, and is asked and carried out once the history has opened', async (context) => {
  // Arrange: a saved study is shown; the learner chooses a Node test history whose journal is still being read.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const read = NodeTestHistoryStore.prototype.read
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
        entered = resolve
      }),
      released = new Promise<void>((resolve) => {
        release = resolve
      })
    context.mock.method(
      NodeTestHistoryStore.prototype,
      'read',
      async function (this: NodeTestHistoryStore, studyId: string) {
        entered()
        await released
        return read.call(this, studyId)
      },
    )
    const opening = sendChoice(harness, 'node-history', nodeHistory.studyId)
    await started
    // Act
    await requestRemoval(harness, shown.id)
    const whileOpening = harness.reader.inspect().view!.studyRemoval
    release()
    await opening
    await requestRemoval(harness, shown.id)
    // Assert
    assert.deepEqual(structuredClone(whileOpening), {
      status: 'refused',
      studyId: shown.id,
      text: 'Wait for the chosen saved study to open.',
    })
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.equal(harness.warningDialogs.length, 1)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a chosen entry that fails to open does not leave the delete button refusing for the rest of the session; fails_when=the marker of an opening saved study or Node test history stays set after its open failed, so every later delete request answers "Wait for the chosen saved study to open."; why_new=the marker did not refuse a delete request before, and a delete request only ever followed an open that succeeded; seam=the library's archive read and the Node history store's read, made to fail by the test
test('after a chosen saved study and a chosen Node test history each failed to open, a delete request is asked and carried out', async (context) => {
  // Arrange: a shown saved study, a second saved study whose archive cannot be read, and a Node test history whose journal cannot be read.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      unreadable = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, shown.id)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === unreadable.id)
          throw new Error('The archive could not be read.')
        return readCheckpoint.call(this, id)
      },
    )
    context.mock.method(NodeTestHistoryStore.prototype, 'read', async () => {
      throw new Error('The journal could not be read.')
    })
    // Act: the saved study fails to open, and the learner cancels the confirmation of the delete request that follows.
    harness.answerWarningDialogs(async () => undefined)
    await sendChoice(harness, 'history', unreadable.id)
    const afterFailedStudy = harness.reader.inspect().view!
    await requestRemoval(harness, shown.id)
    const removalAfterFailedStudy = harness.reader.inspect().view!.studyRemoval,
      dialogsAfterFailedStudy = harness.warningDialogs.length
    // Act again: the Node test history fails to open, and the learner confirms the delete request that follows.
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await sendChoice(harness, 'node-history', nodeHistory.studyId)
    const afterFailedNodeHistory = harness.reader.inspect().view!
    await requestRemoval(harness, shown.id)
    // Assert
    assert.equal(
      afterFailedStudy.errors.includes('Error: The archive could not be read.'),
      true,
    )
    assert.equal(afterFailedStudy.model.selection.studyId, shown.id)
    assert.equal(removalAfterFailedStudy, undefined)
    assert.equal(dialogsAfterFailedStudy, 1)
    assert.equal(
      afterFailedNodeHistory.errors.includes(
        'Error: The journal could not be read.',
      ),
      true,
    )
    assert.equal(afterFailedNodeHistory.nodeHistory, undefined)
    assert.equal(harness.warningDialogs.length, 2)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.deepEqual(
      harness.trashMoves.map((move) => basename(move.path)),
      [`${shown.id}.study.meta.v3.json`, `${shown.id}.study.v3.json`],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a chosen saved study whose request is discarded as stale gives the reader and the delete button back; fails_when=the discarded request keeps its opening marker, so the reader stays loading and every delete request answers "Wait for the chosen saved study to open."; why_new=only failed opens were tested, not a discarded one; seam=the library's archive read, held by the test, and a recording open that fails meanwhile
test('a chosen saved study whose open is discarded because the reader changed meanwhile leaves the earlier study shown and a delete request asked', async (context) => {
  // Arrange: a recorded saved run is shown; another saved study is chosen and its archive read is held. A recording open that fails meanwhile changes the reader's revision.
  const harness = await recordedReaderHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await chooseStudy(harness, harness.studyId)
    const otherRead = holdArchiveRead(context, other.id)
    const revisionAtChoice = harness.reader.inspect().view!.revision
    const opening = sendChoice(harness, 'history', other.id)
    await otherRead.started
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      throw new Error('The historical debugger did not start.')
    }
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording open',
      2_000,
    )
    const revisionAfterFailedOpen = harness.reader.inspect().view!.revision
    // Act: the held read ends after the reader changed; the learner then asks to delete the shown study and cancels.
    otherRead.release()
    await opening
    harness.answerWarningDialogs(async () => undefined)
    await requestRemoval(harness, harness.studyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.notEqual(revisionAfterFailedOpen, revisionAtChoice)
    assert.equal(view.model.selection.studyId, harness.studyId)
    assert.equal(readerSeams(harness).isLoading(), false)
    assert.equal(harness.warningDialogs.length, 1)
    assert.equal(view.studyRemoval, undefined)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a chosen saved study whose read fails after the reader changed gives the reader and the delete button back and adds no storage line; fails_when=the failed stale read keeps its opening marker, or its failure is reported for a view the learner already left; why_new=the discarded request that is tested has a read that succeeds, and the failed reads that are tested are not stale; seam=none
test('a chosen saved study whose archive read fails after the reader changed meanwhile leaves the earlier study shown without a storage failure line, and a delete request is asked', async (context) => {
  // Arrange: a recorded saved run is shown; another saved study is chosen and its archive read is held. A recording open that fails meanwhile changes the reader's revision.
  const harness = await recordedReaderHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await chooseStudy(harness, harness.studyId)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    let otherReadStarted!: () => void, failOtherRead!: () => void
    const started = new Promise<void>((resolve) => {
        otherReadStarted = resolve
      }),
      held = new Promise<void>((resolve) => {
        failOtherRead = resolve
      })
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === other.id) {
          otherReadStarted()
          await held
          throw new Error('The archive could not be read.')
        }
        return readCheckpoint.call(this, id)
      },
    )
    const revisionAtChoice = harness.reader.inspect().view!.revision
    const opening = sendChoice(harness, 'history', other.id)
    await started
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      throw new Error('The historical debugger did not start.')
    }
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording open',
      2_000,
    )
    const revisionAfterFailedOpen = harness.reader.inspect().view!.revision
    // Act: the held read fails after the reader changed; the learner then asks to delete the shown study and cancels.
    failOtherRead()
    await opening
    harness.answerWarningDialogs(async () => undefined)
    await requestRemoval(harness, harness.studyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.notEqual(revisionAfterFailedOpen, revisionAtChoice)
    assert.equal(view.model.selection.studyId, harness.studyId)
    assert.equal(readerSeams(harness).isLoading(), false)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) =>
          line.includes('The archive could not be read.'),
        ),
      ),
      [],
    )
    assert.equal(harness.warningDialogs.length, 1)
    assert.equal(view.studyRemoval, undefined)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a choice the learner overtook with another saved study reports nothing when its own archive read fails later; fails_when=the failure of the overtaken read is reported as a reading failure or re-renders the reader although a newer choice owns it; why_new=the overlapping choices that are tested both open, and the failed reads that are tested belong to the latest choice; seam=none
test('a choice overtaken by a newer saved study adds no failure line when its own archive read fails afterwards, and the newer study stays shown', async (context) => {
  // Arrange: three saved studies; the oldest is shown. The archive read of the first choice is held and fails after the second choice was shown.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      overtaken = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      newer = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, shown.id)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    let overtakenReadStarted!: () => void, failOvertakenRead!: () => void
    const started = new Promise<void>((resolve) => {
        overtakenReadStarted = resolve
      }),
      held = new Promise<void>((resolve) => {
        failOvertakenRead = resolve
      })
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === overtaken.id) {
          overtakenReadStarted()
          await held
          throw new Error('The overtaken archive could not be read.')
        }
        return readCheckpoint.call(this, id)
      },
    )
    const overtakenOpening = sendChoice(harness, 'history', overtaken.id)
    await started
    await sendChoice(harness, 'history', newer.id)
    const shownBeforeFailure =
      harness.reader.inspect().view!.model.selection.studyId
    // Act
    failOvertakenRead()
    await overtakenOpening
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(shownBeforeFailure, newer.id)
    assert.equal(view.model.selection.studyId, newer.id)
    assert.equal(view.study?.id, newer.id)
    assert.equal(view.loading, false)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) =>
          line.includes('The overtaken archive could not be read.'),
        ),
      ),
      [],
    )
    assert.equal(readerSeams(harness).hasErrorOfKind('reading'), false)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a chosen saved study that was read but could not be arranged ends its loading state and says why; fails_when=a failure after the archive read is dropped because the opening marker was already cleared, so the reader loads forever without a reason; why_new=every tested failure happened at the archive read; seam=the reader's open, which rejects as it does while a presentation change is pending
test('a chosen saved study whose arrangement is refused after its archive was read stops loading and names the reason', async () => {
  // Arrange: an earlier saved study; a run that was followed live, then stopped and saved, is the shown study. Arranging the reader is refused.
  const harness = await workspaceHarness()
  try {
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await harness.reader.open()
    await harness.reader.action('stop')
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the finished run',
      2_000,
    )
    harness.reader.open = async (): Promise<void> => {
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
    }
    // Act
    await sendChoice(harness, 'history', earlier.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.loading, false)
    assert.equal(view.model.selection.studyId, earlier.id)
    assert.equal(readerSeams(harness).hasErrorOfKind('reading'), true)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('presentation change')),
      ),
      [
        'Error: A presentation change or reader close is pending. Read its state before another control.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a Node test history the learner chose after a saved study, and already sees, is not taken away when the older saved-study read ends; fails_when=the older request only checks its own marker and the revision, continues, and retires the newer Node test history; why_new=overlapping choices of the two kinds were only tested during a removal; seam=the library's archive read, held by the test
test('a saved-study read that ends after a newer Node test history was chosen and shown leaves that Node test history shown', async (context) => {
  // Arrange: a shown saved study, a second saved study whose archive read is held, and a Node test history.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      slow = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, shown.id)
    const slowRead = holdArchiveRead(context, slow.id)
    const opening = sendChoice(harness, 'history', slow.id)
    await slowRead.started
    await sendChoice(harness, 'node-history', nodeHistory.studyId)
    const shownBeforeRelease =
      harness.reader.inspect().view!.nodeHistory?.header.studyId
    // Act
    slowRead.release()
    await opening
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(shownBeforeRelease, nodeHistory.studyId)
    assert.equal(view.nodeHistory?.header.studyId, nodeHistory.studyId)
    assert.equal(view.loading, false)
    assert.notEqual(view.model.selection.studyId, slow.id)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a chosen entry the reader refuses before it loads still releases the pane that waits for it; fails_when=the reader answers no open request, so the pane cannot tell a refused choice from one still on its way and its delete button waits until another entry is chosen; why_new=the pane guessed the end of an open from revisions and loading flags; seam=the Study pane's webview, stubbed at the vscode boundary, and a presentation message held by the test
test('a saved study chosen while a presentation change is pending is refused and its pane is told that the request ended', async () => {
  // Arrange: a saved study is listed; a presentation change is held half-way.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    const held = harness.holdPresentationMessage()
    release = held.release
    const state = harness.reader.presentationState()
    const change = harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      .catch(() => undefined)
    await held.started
    // Act
    sendFromPane(harness, {
      type: 'history',
      studyId: study.id,
      openRequest: 3,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    const view = harness.reader.inspect().view!
    held.release()
    await change
    // Assert
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'context', openRequest: 3 },
    ])
    assert.notEqual(view.model.selection.studyId, study.id)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('presentation change')),
      ),
      [
        'Error: A presentation change or reader close is pending. Read its state before another control.',
      ],
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a Node test history chosen during Recording is refused with its sentence and the pane that chose it is released; fails_when=the refusal is thrown before any loading state, the pane never hears of it and keeps "Wait for the chosen saved study to open."; why_new=the refusal existed, its answer to the pane did not; seam=the summary webview, stubbed at the vscode boundary
test('a Node test history chosen during Recording is refused with its sentence and its pane is told that the request ended', async () => {
  // Arrange: a saved recorded run whose recording is open, and a saved Node test history.
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    // Act
    sendFromPane(harness, {
      type: 'node-history',
      studyId: nodeHistory.studyId,
      openRequest: 4,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'summary', openRequest: 4 },
    ])
    assert.equal(view.nodeHistory, undefined)
    assert.equal(
      view.errors.includes(
        'Error: Close browser replay before opening a separate Node test history.',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a stale refusal line after the learner did what it asked; fails_when=the Node refusal is reported under `control`, which only a live-run action retires, so it stays after a later successful Node open; why_new=Cycle 0044 (0031-U5); seam=the summary webview, stubbed at the vscode boundary
test('the browser-replay refusal of a Node test history disappears once that history opens after the learner left Recording', async () => {
  // Arrange: a Node history was refused during Recording, then the learner left Recording.
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    sendFromPane(harness, {
      type: 'node-history',
      studyId: nodeHistory.studyId,
      openRequest: 4,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the refused open request',
      1_000,
    )
    const refusal =
      'Error: Close browser replay before opening a separate Node test history.'
    const refusedErrors = [...harness.reader.inspect().view!.errors]
    await readerSeams(harness).receive(
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )

    // Act: sent past the pane route, whose own retirement of a refused choice would hide a missing Node history one.
    await sendChoice(harness, 'node-history', nodeHistory.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.nodeHistory !== undefined,
      'the opened Node test history',
      2_000,
    )

    // Assert
    assert.equal(refusedErrors.includes(refusal), true)
    assert.equal(harness.reader.inspect().view!.errors.includes(refusal), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the Node test history refusal behaves like every other refused pane control: no Retry storage for it, and it does not stay through the learner's later choices; fails_when=the refusal's own line (`node-history-control`) is counted as a storage failure, or only a later Node history open retires it (0039-N8-c, 0040-N9-1 with 0031-U5); why_new=the merge of the two Cycle 0044 fixes gave this refusal a line of its own; seam=the summary webview, stubbed at the vscode boundary
test('the browser-replay refusal of a Node test history offers no Retry storage and is gone once the learner’s next pane choice is handled', async () => {
  // Arrange: a Node history was refused during Recording.
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    sendFromPane(harness, {
      type: 'node-history',
      studyId: nodeHistory.studyId,
      openRequest: 4,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the refused open request',
      1_000,
    )
    const refusal =
      'Error: Close browser replay before opening a separate Node test history.'
    const refused = structuredClone(harness.reader.inspect().view!)

    // Act: the learner chooses a tab in the pane.
    harness.receive({
      type: 'tab',
      revision: harness.reader.inspect().view!.revision,
      tab: 'overview',
    })
    await waitUntil(
      () => !harness.reader.inspect().view!.errors.includes(refusal),
      'the retired refusal',
      1_000,
    )

    // Assert: the measured recording layout is confirmed; only the refused Node-history choice needs a notice.
    assert.deepEqual(refused.errors, [refusal])
    assert.equal(refused.unretryableErrorCount, 1)
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.errors), [])
    assert.equal(view.unretryableErrorCount, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved study chosen during Recording keeps its pane waiting while that recording loads, and releases it when the load failed; fails_when=the reply is posted as soon as the open was accepted, so the delete button names the study shown before while another recording is on its way, or it is never posted after a failed load; why_new=a recording open outlives the message that started it; seam=the reader's replay-debugger preparation, held and then failed by the test
test('a saved study chosen during Recording is answered only once its recording load has ended', async () => {
  // Arrange: a saved recorded run whose recording is open; the next recording load is held before it can fail.
  const harness = await recordedReaderHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    let failLoad!: () => void, loadEntered!: () => void
    const loadStarted = new Promise<void>((resolve) => {
        loadEntered = resolve
      }),
      loadHeld = new Promise<void>((resolve) => {
        failLoad = resolve
      })
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      loadEntered()
      await loadHeld
      throw new Error('The historical debugger did not start.')
    }
    // Act: the choice starts the other study's recording load; the load then fails.
    sendFromPane(harness, {
      type: 'history',
      studyId: other.id,
      openRequest: 5,
    })
    await loadStarted
    // The message that started the load has been handled to its end once the pending microtasks have run.
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const readinessWhileLoading = harness.controller.state().readiness,
      repliesWhileLoading = harness.openRequestReplies()
    failLoad()
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording load',
      2_000,
    )
    // Assert
    assert.equal(readinessWhileLoading, 'loading')
    assert.deepEqual(repliesWhileLoading, [])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'summary', openRequest: 5 },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a pane waiting for a recording load is answered when the Study workspace closes before that load has ended; fails_when=the held-back reply is posted only by a load that finishes or fails, so an abandoned load leaves the delete button waiting; why_new=the only held-back reply that is tested ends by a failed load; seam=none
test('a saved study chosen in the bottom panel during Recording is answered when the Study workspace is closed before its recording has loaded', async () => {
  // Arrange: a saved recorded run whose recording is open; the next recording load is held and never ends by itself.
  const harness = await recordedReaderHarness()
  let endHeldLoad = (): void => {}
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    let hasLoadStarted = false
    const loadHeld = new Promise<void>((resolve) => {
      endHeldLoad = resolve
    })
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      hasLoadStarted = true
      await loadHeld
    }
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: other.id,
      openRequest: 2,
    })
    await waitUntil(
      () => hasLoadStarted,
      'the held load of the chosen recording',
      2_000,
    )
    // The message that started the load has been handled to its end once the pending microtasks have run.
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const readinessWhileLoading = harness.controller.state().readiness,
      repliesWhileLoading = harness.openRequestReplies()
    // Act: the learner closes the Study workspace while the chosen recording is still loading.
    await harness.reader.close()
    // Assert
    assert.equal(readinessWhileLoading, 'loading')
    assert.deepEqual(repliesWhileLoading, [])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'moments', openRequest: 2 },
    ])
    assert.equal(harness.reader.inspect().opened, false)
  } finally {
    endHeldLoad()
    await harness.close()
  }
})

// Value: protects=a saved study chosen during Recording that starts no recording load is answered at once; fails_when=every choice made during Recording waits for a playback change, which a refused choice never causes; why_new=the Recording cases either hold a recording load or choose a Node test history; seam=none
test('a saved study chosen during Recording with an outdated view is refused, answered at once and leaves the open recording as it is', async () => {
  // Arrange: a saved recorded run whose recording is open and ready, and another saved study.
  const harness = await recordedReaderHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    const outdatedRevision = harness.reader.inspect().view!.revision - 1
    // Act: the pane's choice carries a revision the reader has left behind.
    harness.receive({
      type: 'history',
      revision: outdatedRevision,
      studyId: other.id,
      openRequest: 7,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'summary', openRequest: 7 },
    ])
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().studyId, harness.studyId)
    assert.equal(
      view.errors.includes(
        'Error: The displayed study changed. Inspect the current view before acting.',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a chosen saved study that opens is answered too, so a pane never waits on a request the reader has finished; fails_when=only refusals are answered and a pane whose Study message was dropped keeps its choice; why_new=open requests had no number; seam=the Study pane's webview, stubbed at the vscode boundary
test('a chosen saved study that opens is shown and its pane is told that the request ended', async () => {
  // Arrange: two saved studies; the older one is shown.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    // Act
    sendFromPane(harness, {
      type: 'history',
      studyId: chosen.id,
      openRequest: 6,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, chosen.id)
    assert.equal(view.loading, false)
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'context', openRequest: 6 },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved study chosen in the bottom panel while the Study workspace is closed is shown in that panel; fails_when=a closed reader selects the study but publishes nothing and stays loading, so the panel keeps the earlier study's content and, once the request is answered, its list falls back to that earlier study as if the choice had been ignored; why_new=found natively on the candidate: after a fresh editor start the bottom panel is up while the Study workspace is closed; seam=the bottom panel's webview, stubbed at the vscode boundary
test('a saved study chosen in the bottom panel while the Study workspace is closed is shown there and stops loading', async () => {
  // Arrange: two saved studies; the older one is shown, then the Study workspace is closed and the bottom panel is resolved again, as after an editor restart.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    await harness.reader.close()
    await harness.resolveRestoredObservedMoments()
    const library = await harness.reader.learningStorage()
    // Act
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      studyId: chosen.id,
      openRequest: 1,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    // Assert
    const panel = harness.playbackPanelMessages.at(-1)!
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(panel.model.selection.studyId, chosen.id)
    assert.equal(panel.loading, false)
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'moments', openRequest: 1 },
    ])
    assert.equal((await library.readProgress()).selection?.studyId, chosen.id)
  } finally {
    await harness.close()
  }
})

// Value: protects=the first Saved study choice in an already visible bottom panel after Close; fails_when=Close advances the reader revision without publishing it, so the visible control sends the old revision and the first choice is refused; why_new=Cycle 0046 task 392, native Cursor revision 10 remained in the visible pane after the closed reader advanced to 11; seam=existing bottom-panel message boundary, no repeated view resolution
test('the first Saved study choice after closing the workspace opens in the already visible bottom panel', async () => {
  // Arrange: keep the existing view resolved through Close, as a learner does.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    await harness.resolveRestoredObservedMoments()
    harness.playbackPanel.visible = true
    await harness.reader.close()
    const displayed = harness.playbackPanelMessages.at(-1)!

    // Act: copy the authority actually displayed, without refreshing the view.
    harness.receivePlaybackPanel({
      type: 'history',
      revision: displayed.revision,
      studyId: chosen.id,
      openRequest: 1,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the first choice after Close to finish',
      1_000,
    )

    // Assert: the first request selects the study instead of a stale-view error.
    const panel = harness.playbackPanelMessages.at(-1)!
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(panel.model.selection.studyId, chosen.id)
    assert.equal(panel.loading, false)
    assert.deepEqual([...panel.errors], [])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'moments', openRequest: 1 },
    ])
    const library = await harness.reader.learningStorage()
    assert.equal((await library.readProgress()).selection?.studyId, chosen.id)
  } finally {
    await harness.close()
  }
})

// Value: protects=the first Saved study choice after the editor cancels Close; fails_when=the rejected close leaves the visible pane's old revision while the reader accepts only the new one; why_new=task 392's close lifetime changes before native tab closing can fail; seam=existing native tab-close cancellation
test('the first Saved study choice after a canceled workspace close opens without refreshing the bottom panel', async () => {
  // Arrange: the same visible view survives a native close cancellation.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    await harness.resolveRestoredObservedMoments()
    harness.playbackPanel.visible = true
    harness.rejectNextTabClose()
    await assert.rejects(harness.reader.close(), { message: 'Canceled' })
    const displayed = harness.playbackPanelMessages.at(-1)!

    // Act: use that view's authority on its first choice after cancellation.
    harness.receivePlaybackPanel({
      type: 'history',
      revision: displayed.revision,
      studyId: chosen.id,
      openRequest: 1,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the first choice after canceled Close to finish',
      1_000,
    )

    // Assert: the canceled close does not require a failed choice to refresh.
    const panel = harness.playbackPanelMessages.at(-1)!
    assert.equal(panel.model.selection.studyId, chosen.id)
    assert.equal(panel.loading, false)
    assert.deepEqual([...panel.errors], [])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'moments', openRequest: 1 },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a choice overtaken on a closed Study workspace does not end the loading state of the newer choice in the bottom panel; fails_when=the overtaken choice publishes itself as shown once its selection is saved, while the newer study is still being read; why_new=the closed-reader case makes a single choice; seam=none
test('a choice overtaken in the bottom panel of a closed Study workspace leaves the newer choice loading until that study is shown', async (context) => {
  // Arrange: three saved studies; the oldest is shown, then the Study workspace is closed and the bottom panel is resolved again. The selection save of the first choice and the archive read of the second are held.
  const harness = await workspaceHarness()
  let releaseSelectionSave = (): void => {}
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      overtaken = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      newer = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, shown.id)
    await harness.reader.close()
    await harness.resolveRestoredObservedMoments()
    const library = await harness.reader.learningStorage()
    const select = LearningLibrary.prototype.select
    let isSelectionSaveHeld = false
    const selectionSaveReleased = new Promise<void>((resolve) => {
      releaseSelectionSave = resolve
    })
    context.mock.method(
      LearningLibrary.prototype,
      'select',
      async function (
        this: LearningLibrary,
        selection: Parameters<LearningLibrary['select']>[0],
      ) {
        if (selection.studyId === overtaken.id && !isSelectionSaveHeld) {
          isSelectionSaveHeld = true
          await selectionSaveReleased
        }
        return select.call(this, selection)
      },
    )
    const newerRead = holdArchiveRead(context, newer.id)
    // Act: the second choice arrives while the first one's selection is being saved; that save then ends while the second study is still being read.
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      studyId: overtaken.id,
      openRequest: 1,
    })
    await waitUntil(
      () => isSelectionSaveHeld,
      'the held selection save of the first choice',
      1_000,
    )
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      studyId: newer.id,
      openRequest: 2,
    })
    await newerRead.started
    releaseSelectionSave()
    await waitUntil(
      () => harness.openRequestReplies().length === 1,
      'the reply to the overtaken choice',
      1_000,
    )
    const panelWhileNewerOpens = harness.playbackPanelMessages.at(-1)!,
      repliesWhileNewerOpens = harness.openRequestReplies()
    newerRead.release()
    await waitUntil(
      () => harness.openRequestReplies().length === 2,
      'the reply to the newer choice',
      1_000,
    )
    // Assert
    const panel = harness.playbackPanelMessages.at(-1)!
    assert.deepEqual(repliesWhileNewerOpens, [
      { webview: 'moments', openRequest: 1 },
    ])
    assert.equal(panelWhileNewerOpens.loading, true)
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(panel.model.selection.studyId, newer.id)
    assert.equal(panel.loading, false)
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'moments', openRequest: 1 },
      { webview: 'moments', openRequest: 2 },
    ])
    assert.equal((await library.readProgress()).selection?.studyId, newer.id)
  } finally {
    releaseSelectionSave()
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=two choices made one after the other are each answered by their own number, so the pane releases the right one; fails_when=the reader keeps one request slot, answers only the newer choice or answers the older number twice; why_new=open requests had no number; seam=the library's archive read, held by the test
test('two overlapping choices from one pane are each answered once with their own number', async (context) => {
  // Arrange: three saved studies; the oldest is shown, and the archive read of the first choice is held.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      slow = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      quick = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, shown.id)
    const slowRead = holdArchiveRead(context, slow.id)
    // Act: the second choice overtakes the first, whose read then ends.
    sendFromPane(harness, { type: 'history', studyId: slow.id, openRequest: 1 })
    await slowRead.started
    sendFromPane(harness, {
      type: 'history',
      studyId: quick.id,
      openRequest: 2,
    })
    await waitUntil(
      () => harness.openRequestReplies().length === 1,
      'the reply to the newer choice',
      1_000,
    )
    const repliesBeforeRelease = harness.openRequestReplies()
    slowRead.release()
    await waitUntil(
      () => harness.openRequestReplies().length === 2,
      'the reply to the overtaken choice',
      1_000,
    )
    // Assert
    assert.deepEqual(repliesBeforeRelease, [
      { webview: 'context', openRequest: 2 },
    ])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'context', openRequest: 2 },
      { webview: 'context', openRequest: 1 },
    ])
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      quick.id,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a choice sent without a request number opens its study as before and is not answered; fails_when=the reader replies to every history message, so an agent-side or older sender receives a message it never asked for; why_new=the reply is new; seam=the Study pane's webview, stubbed at the vscode boundary
test('a chosen saved study sent without a request number opens and no reply is posted', async () => {
  // Arrange: two saved studies; the older one is shown.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    // Act
    sendFromPane(harness, { type: 'history', studyId: chosen.id })
    await waitUntil(
      () =>
        harness.reader.inspect().view!.model.selection.studyId === chosen.id &&
        !harness.reader.inspect().view!.loading,
      'the chosen saved study',
      1_000,
    )
    // Assert
    assert.deepEqual(harness.openRequestReplies(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a request number that is not a positive integer is rejected like any malformed reader message; fails_when=the number is read loosely, so a zero or a text opens a study or is answered; why_new=the field is new; seam=the Study pane's webview, stubbed at the vscode boundary
test('a choice whose request number is zero or a text is rejected as an unsupported message and is not answered', async () => {
  // Arrange: two saved studies; the older one is shown.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    // Act: a zero, then a text.
    sendFromPane(harness, {
      type: 'history',
      studyId: chosen.id,
      openRequest: 0,
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.includes('Error: Unsupported reader message.'),
      'the rejected zero',
      1_000,
    )
    const selectionAfterZero =
      harness.reader.inspect().view!.model.selection.studyId
    readerSeams(harness).dropErrorOfKind('control')
    sendFromPane(harness, {
      type: 'history',
      studyId: chosen.id,
      openRequest: 'x',
    })
    await waitUntil(
      () => readerSeams(harness).hasErrorOfKind('control'),
      'the rejected text',
      1_000,
    )
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(selectionAfterZero, shown.id)
    assert.equal(view.model.selection.studyId, shown.id)
    assert.equal(
      view.errors.includes('Error: Unsupported reader message.'),
      true,
    )
    assert.deepEqual(harness.openRequestReplies(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a study whose recording is on its way to the screen is never moved underneath it; fails_when=the refusal looks only at a Recording that is already active, so a delete right after pressing Recording moves the files the load is reading; why_new=the Recording refusal was only tested once the recording had opened; seam=the reader's replay-debugger preparation, held by the test
test('a removal is refused while a recording is still opening, also when the open is accepted while the confirmation is waiting', async () => {
  // Arrange: a saved recorded run; the load of its recording is held before Recording becomes active.
  const harness = await recordedReaderHarness()
  try {
    const prepareDebugger = readerSeams(harness).debuggerReplacement
    let releaseLoad = (): void => {}
    const holdNextLoad = (): void => {
      const held = new Promise<void>((resolve) => {
        releaseLoad = resolve
      })
      readerSeams(harness).debuggerReplacement = async (
        signal,
      ): Promise<void> => {
        await held
        await prepareDebugger(signal)
      }
    }
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    holdNextLoad()
    // Act: a delete request right after the open was accepted.
    await harness.reader.openRecording(harness.studyId)
    const activeWhileOpening = readerSeams(harness).isRecordingActive(),
      readinessWhileOpening = harness.controller.state().readiness
    await requestRemoval(harness, harness.studyId)
    const whileOpening = harness.reader.inspect().view!.studyRemoval
    const dialogsWhileOpening = harness.warningDialogs.length
    releaseLoad()
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    // Act again: Recording is left, the dialog opens, and an open is accepted before the learner confirms.
    await readerSeams(harness).receive(
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )
    let confirm!: () => void
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === dialogsWhileOpening + 1,
      'the confirmation dialog',
      1_000,
    )
    holdNextLoad()
    await harness.reader.openRecording(harness.studyId)
    const activeWhileConfirming = readerSeams(harness).isRecordingActive()
    confirm()
    await removal
    const afterAnswer = harness.reader.inspect().view!.studyRemoval
    releaseLoad()
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the recording opened during the dialog',
      2_000,
    )
    // Assert
    assert.equal(activeWhileOpening, false)
    assert.equal(readinessWhileOpening, 'loading')
    assert.deepEqual(structuredClone(whileOpening), {
      status: 'refused',
      studyId: harness.studyId,
      text: 'Choose Overview or Live to leave Recording before deleting this study.',
    })
    assert.equal(dialogsWhileOpening, 0)
    assert.equal(activeWhileConfirming, false)
    assert.deepEqual(structuredClone(afterAnswer), {
      status: 'refused',
      studyId: harness.studyId,
      text: 'Choose Overview or Live to leave Recording before deleting this study.',
    })
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a study whose recording is on its way to the screen while the dialog about a recording of another computer is open is never moved underneath it; fails_when="Move to Trash Anyway" moves the study without the refusals the first dialog's answer is checked against, so the files the Recording load reads go to the Trash (S3); why_new=Cycle 0046 CodeRabbit review CR1 (S3): the second dialog's answer was not checked again; seam=the reader's replay-debugger preparation, held by the test, a recordings.v3 header of another host beside the study's sealed recording, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a recording opened while the dialog about a recording of another computer is open refuses the removal after Move to Trash Anyway, and nothing moves', async () => {
  // Arrange: a saved recorded run, with a recording of the same study that names old-laptop.local beside its own; the load of a recording is held before Recording becomes active.
  const harness = await recordedReaderHarness()
  try {
    const ofAnotherComputer = join(
      harness.reader.inspect().libraryDirectory!,
      'recordings.v3',
      harness.studyId,
    )
    await mkdir(ofAnotherComputer, { recursive: true })
    await writeFile(
      join(ofAnotherComputer, 'header.json'),
      JSON.stringify({
        owner: {
          pid: ID_OF_NO_PROCESS,
          hostname: 'old-laptop.local',
          sessionId: randomUUID(),
        },
        createdAt: '2026-10-01T08:00:00.000Z',
      }),
    )
    const prepareDebugger = readerSeams(harness).debuggerReplacement
    let releaseLoad = (): void => {}
    const held = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    readerSeams(harness).debuggerReplacement = async (
      signal,
    ): Promise<void> => {
      await held
      await prepareDebugger(signal)
    }
    let moveAnyway!: () => void
    harness.answerWarningDialogs(([button]) =>
      button === `Move to ${TRASH} Anyway`
        ? new Promise<string | undefined>((resolve) => {
            moveAnyway = (): void => resolve(button)
          })
        : Promise.resolve(button),
    )

    // Act: the learner opens Recording while the second dialog waits, then chooses Move to Trash Anyway.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === 2,
      'the dialog about the recording of another computer',
      1_000,
    )
    await harness.reader.openRecording(harness.studyId)
    moveAnyway()
    await removal
    const afterAnswer = structuredClone(
      harness.reader.inspect().view!.studyRemoval,
    )
    releaseLoad()
    // The held load ends either way; which recording it shows is not this test's.
    await waitUntil(
      () => harness.controller.state().readiness !== 'loading',
      'the end of the load started during the dialog',
      2_000,
    )

    // Assert
    assert.deepEqual(
      { afterAnswer, moved: harness.trashMoves },
      {
        afterAnswer: {
          status: 'refused',
          studyId: harness.studyId,
          text: 'Choose Overview or Live to leave Recording before deleting this study.',
        },
        moved: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a recording that failed to open before Recording became active does not lock its study against deletion; fails_when=the refusal remembers the failed open instead of reading the controller, so the study can never be removed in that window; why_new=the refusal now also covers an open in flight and must end with it; seam=the reader's replay-debugger preparation, made to fail by the test
test('after a recording open failed before Recording became active, the study can be removed', async () => {
  // Arrange: a saved recorded run whose recording load fails at its first step.
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      throw new Error('The historical debugger did not start.')
    }
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording open',
      2_000,
    )
    // Act
    await requestRemoval(harness, harness.studyId)
    // Assert
    assert.equal(readerSeams(harness).isRecordingActive(), false)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.equal(harness.trashMoves.length > 0, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a recording that failed after Recording became active keeps its study from being removed until the learner leaves Recording; fails_when=a failed load is read as "no recording open" although the Recording surface is still up; why_new=the refusal now reads the controller's loading state beside the active flag; seam=the recording store's read, made to fail by the test
test('after a recording open failed once Recording was active, a removal stays refused until Recording is left', async (context) => {
  // Arrange: a saved recorded run whose recording cannot be read after Recording became active.
  const harness = await recordedReaderHarness()
  try {
    context.mock.method(RecordingStore.prototype, 'read', async () => {
      throw new Error('The recording could not be read.')
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording open',
      2_000,
    )
    // Act
    await requestRemoval(harness, harness.studyId)
    const whileRecordingIsUp = harness.reader.inspect().view!.studyRemoval
    context.mock.restoreAll()
    await readerSeams(harness).receive(
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )
    await requestRemoval(harness, harness.studyId)
    // Assert
    assert.deepEqual(structuredClone(whileRecordingIsUp), {
      status: 'refused',
      studyId: harness.studyId,
      text: 'Choose Overview or Live to leave Recording before deleting this study.',
    })
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the study a learner chooses during a removal is the one the reader ends on; fails_when=the neighbour of the removed study is applied after the learner's newer choice and replaces it, on screen and in the saved selection; why_new=the neighbour was only tested without a choice during its read; seam=the library's archive read, held by the test
test('a saved study chosen while the neighbour of a removed study is being read is shown and saved, and the neighbour never is', async (context) => {
  // Arrange: three studies; the middle one is shown and removed, the oldest is its neighbour, the newest is chosen meanwhile.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const select = LearningLibrary.prototype.select
    const savedSelections: (string | undefined)[] = []
    context.mock.method(
      LearningLibrary.prototype,
      'select',
      function (
        this: LearningLibrary,
        selection: Parameters<LearningLibrary['select']>[0],
      ) {
        savedSelections.push(selection.studyId)
        return select.call(this, selection)
      },
    )
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    // Act
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    await sendChoice(harness, 'history', chosen.id)
    neighbourRead.release()
    await removal
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, chosen.id)
    assert.equal(view.study?.id, chosen.id)
    assert.equal((await library.readProgress()).selection?.studyId, chosen.id)
    assert.equal(savedSelections.includes(neighbour.id), false)
    assert.equal(view.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a study the learner chose while another was being deleted opens, instead of being cancelled by the deletion; fails_when=the neighbour cancels the pending choice and shows itself; why_new=the neighbour was only tested with nothing else opening; seam=the library's archive read and the editor's Trash, both held by the test
test('a saved study that is still opening when a removal settles is shown, and the removal still reports what it moved', async (context) => {
  // Arrange: the shown study's removal is moving files; the learner chooses another entry, whose archive read is held.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const trashMove = harness.holdTrashMove()
    const removal = requestRemoval(harness, removed.id)
    await trashMove.started
    const chosenRead = holdArchiveRead(context, chosen.id)
    const opening = sendChoice(harness, 'history', chosen.id)
    await chosenRead.started
    // Act: the removal settles while the choice is still opening, then the choice opens.
    trashMove.release()
    await removal
    const whenRemovalSettled = harness.reader.inspect().view!
    chosenRead.release()
    await opening
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(whenRemovalSettled.model.selection.studyId, undefined)
    assert.equal(view.model.selection.studyId, chosen.id)
    assert.equal(view.study?.id, chosen.id)
    assert.equal(view.loading, false)
    assert.equal((await library.readProgress()).selection?.studyId, chosen.id)
    assert.deepEqual(structuredClone(whenRemovalSettled.studyRemoval), {
      status: 'moved',
      studyId: removed.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 2 of 64 saved studies.`,
    })
    assert.equal(
      view.studies.some((entry) => entry.id === neighbour.id),
      true,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a Node test history the learner chose while a study was being deleted opens; fails_when=the neighbour takes the shared request number and the Node history's load gives up, leaving the reader loading forever; why_new=a Node test history that is opening had no marker the neighbour could see; seam=the Node history store's read and the editor's Trash, both held by the test
test('a Node test history that is still opening when a removal settles is shown instead of the neighbour', async (context) => {
  // Arrange: two saved studies and a Node test history; the shown study's removal is moving files when the history is chosen.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const trashMove = harness.holdTrashMove()
    const removal = requestRemoval(harness, removed.id)
    await trashMove.started
    const read = NodeTestHistoryStore.prototype.read
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
        entered = resolve
      }),
      released = new Promise<void>((resolve) => {
        release = resolve
      })
    context.mock.method(
      NodeTestHistoryStore.prototype,
      'read',
      async function (this: NodeTestHistoryStore, studyId: string) {
        entered()
        await released
        return read.call(this, studyId)
      },
    )
    const opening = sendChoice(harness, 'node-history', nodeHistory.studyId)
    await started
    // Act
    trashMove.release()
    await removal
    release()
    await opening
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.nodeHistory?.header.studyId, nodeHistory.studyId)
    assert.equal(view.loading, false)
    assert.notEqual(view.model.selection.studyId, neighbour.id)
    assert.equal(view.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=after the study of a just-finished live run is deleted, the neighbour is shown in the reader's own arrangement, as a study chosen from the list is; fails_when=the neighbour is selected without arranging the reader, so the live arrangement stays up around a saved study; why_new=the neighbour was only tested from the reader's own arrangement; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('removing the shown study of a finished live run arranges the reader for the neighbour the way a chosen entry is arranged', async () => {
  // Arrange: an earlier saved study; a run that was followed live, then stopped and saved, is the shown study.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
      harness,
      '2026-09-20T00:00:01.000Z',
    )
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await harness.reader.open()
    const liveWhileRunning = readerSeams(harness).isLiveArrangement()
    await harness.reader.action('stop')
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the finished run',
      2_000,
    )
    const shownBeforeRemoval =
      harness.reader.inspect().view!.model.selection.studyId
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const open = harness.reader.open.bind(harness.reader)
    let arrangements = 0
    harness.reader.open = async (...openArguments): Promise<void> => {
      arrangements++
      await open(...openArguments)
    }
    // Act
    await requestRemoval(harness, liveStudyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(liveWhileRunning, true)
    assert.equal(shownBeforeRemoval, liveStudyId)
    assert.equal(view.studyRemoval?.status, 'moved')
    assert.equal(view.model.selection.studyId, neighbour.id)
    assert.equal(arrangements, 1)
    assert.equal(readerSeams(harness).isLiveArrangement(), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a Study workspace the learner closes while a removal is still settling stays closed, and the removal still ends with its outcome and the neighbour remembered; fails_when=the neighbour of the removed study arranges the reader although it was closed, so the Study workspace opens again on its own or the removal ends without its outcome line; why_new=the neighbour now arranges the reader when a live composition is up, and that was only tested with the reader open; seam=the library's archive read, held by the test
test('a reader closed while the neighbour of the removed study of a finished live run is being read stays closed, and the neighbour is remembered', async (context) => {
  // Arrange: an earlier saved study; a run that was followed live, then stopped and saved, is the shown study. The read of the neighbour is held.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
      harness,
      '2026-09-20T00:00:01.000Z',
    )
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await harness.reader.open()
    await harness.reader.action('stop')
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the finished run',
      2_000,
    )
    const liveArrangementBeforeRemoval =
      readerSeams(harness).isLiveArrangement()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    // Act: the learner confirms the removal and closes the Study workspace before the neighbour has been read.
    const removal = requestRemoval(harness, liveStudyId)
    await neighbourRead.started
    await harness.reader.close()
    const openedAfterClose = harness.reader.inspect().opened
    neighbourRead.release()
    await removal
    // Assert
    assert.equal(liveArrangementBeforeRemoval, true)
    assert.equal(openedAfterClose, false)
    assert.equal(harness.reader.inspect().opened, false)
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyRemoval),
      {
        status: 'moved',
        studyId: liveStudyId,
        text: `Saved study moved to the ${TRASH}. The library now holds 1 of 64 saved studies.`,
      },
    )
    assert.equal(
      (await library.readProgress()).selection?.studyId,
      neighbour.id,
    )
    // The closed reader no longer names the study that went to the Trash.
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      neighbour.id,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a removal that moved every file says so even when the storage lock cannot be released, and no waiting checkpoint writes the study back; fails_when=the reader reads the lock's failure as "nothing was deleted", keeps the run as a checkpoint candidate and resumes its held-back write; why_new=no reader test made the lock release fail after the moves; seam=the editor's Trash, stubbed at the vscode boundary, from whose last move on the lock file can no longer be removed
test('a removal whose storage lock cannot be released after every file moved reports the study as moved, names the lock in the reader and writes no waiting checkpoint', async (context) => {
  // Arrange: a recorded, stopped and saved run; its next study save is held and a newer checkpoint waits behind it. From the archive's move on the lock file can no longer be removed, so the lock stays.
  const harness = await recordedReaderHarness()
  try {
    const directory = harness.reader.inspect().libraryDirectory!
    const saveStudy = LearningLibrary.prototype.saveStudy
    let studySaves = 0
    let releaseFirstSave!: () => void
    const firstSaveHeld = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        studySaves++
        if (studySaves === 1) await firstSaveHeld
        return saveStudy.call(this, study)
      },
    )
    const snapshotUri = harness.service.state(harness.record).participants
      .browser.snapshotUri!
    const explain = (key: string, interpretation: string) =>
      harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: harness.record.id,
        key,
        snapshotUri,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation,
      })
    await explain('write-in-flight', 'The first later explanation.')
    await readerSeams(harness).refresh()
    await waitUntil(() => studySaves === 1, 'the held study save', 2_000)
    await explain('waiting-checkpoint', 'The second later explanation.')
    await readerSeams(harness).refresh()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.beforeTrashMoves(async (path) => {
      if (path.endsWith('.study.v3.json'))
        await refuseLockRelease(context, directory)
    })
    // Act: the learner confirms while the first save is in flight; every file then moves and the lock release fails.
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    releaseFirstSave()
    await removal
    await new Promise((resolve) => setTimeout(resolve, 50))
    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'moved',
      studyId: harness.studyId,
      text: `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
    })
    assert.equal(
      view.studies.some((entry) => entry.id === harness.studyId),
      false,
    )
    assert.equal(studySaves, 1)
    assert.deepEqual(await studyFiles(harness), [])
    assert.equal(harness.record.historyExcluded, 'removed-by-learner')
    const lockLines = view.errors.filter((line) =>
      line.includes('storage lock'),
    )
    assert.equal(lockLines.length, 1)
    assert.equal(
      lockLines[0]!.startsWith(
        'Error: Learning storage lock could not be released after the removal: ',
      ),
      true,
    )
    assert.equal(
      lockLines[0]!.endsWith(
        `unlink '${join(await realpath(directory), 'writer.lock')}'`,
      ),
      true,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a removal keeps its outcome line when the reader cannot arrange the study that follows; fails_when=the arrangement's rejection skips the outcome, so the learner sees a control error and no "moved" line, with a neighbour selected that was never shown; why_new=the neighbour was only tested with an arrangement that succeeds; seam=the reader's open, which rejects as it does while a presentation change is pending
test('a removal whose next study cannot be arranged still reports the study as moved, shows no study and names the arrangement failure', async () => {
  // Arrange: an earlier saved study; a run that was followed live, then stopped and saved, is the shown study. Arranging the reader is refused.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
      harness,
      '2026-09-20T00:00:01.000Z',
    )
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await harness.reader.open()
    await harness.reader.action('stop')
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the finished run',
      2_000,
    )
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.reader.open = async (): Promise<void> => {
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
    }
    // Act
    await requestRemoval(harness, liveStudyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'moved',
      studyId: liveStudyId,
      text: `Saved study moved to the ${TRASH}. The library now holds 1 of 64 saved studies.`,
    })
    assert.equal(view.model.selection.studyId, undefined)
    assert.equal((await library.readProgress()).selection?.studyId, undefined)
    assert.equal(
      view.studies.some((entry) => entry.id === neighbour.id),
      true,
    )
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('presentation change')),
      ),
      [
        'Error: A presentation change or reader close is pending. Read its state before another control.',
      ],
    )
    assert.equal(readerSeams(harness).hasErrorOfKind('control'), false)
    assert.equal(readerSeams(harness).hasErrorOfKind('reading'), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that makes room for a refused run still tells the learner to start it again when the study that follows cannot be arranged; fails_when=the arrangement's rejection skips the outcome, so the "did not start" line stays although the library has room and no next step is named; why_new=the failed arrangement was only tested without a refused run, and the next step only with an arrangement that succeeds; seam=none
test('a removal that makes room for a refused run names the next step and retires the refusal line although the next study cannot be arranged', async () => {
  // Arrange: a library of two that the saved study of a finished live run fills, a run refused on it, and a reader that refuses to be arranged.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(2)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await harness.reader.open()
    await harness.reader.action('stop')
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the finished run',
      2_000,
    )
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    const refusalBefore = harness.reader.inspect().view!.runRefusal
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.reader.open = async (): Promise<void> => {
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
    }
    // Act
    await requestRemoval(harness, liveStudyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(refused.record.error?.message, FULL_LIBRARY_REFUSAL)
    assert.equal(
      refusalBefore,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'moved',
      studyId: liveStudyId,
      text: `Saved study moved to the ${TRASH}. The library now holds 1 of 2 saved studies. Ask your editor agent to start the run again.`,
    })
    assert.equal(view.runRefusal, undefined)
    assert.equal(view.model.selection.studyId, undefined)
    assert.equal(readerSeams(harness).hasErrorOfKind('control'), false)
    assert.equal(readerSeams(harness).hasErrorOfKind('reading'), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a study of which no file left the library stays the reader's study when only the ledger write-back failed; fails_when=that failure is treated as a partial removal, so the run is dropped from history and never saved again although its study is whole; why_new=the reader was only tested with a write-back that succeeds; seam=the editor's Trash, stubbed at the vscode boundary, which blocks the ledger path before it refuses the move
test('a removal that moved no file and cannot write the ledger back says that nothing was deleted and keeps the run saved and offered for Save learning replay', async () => {
  // Arrange: a recorded, stopped and saved run, chosen so the ledger names its study, without a recording directory, so the ledger is rewritten before the first file move. That move is refused after the ledger path was blocked.
  const harness = await recordedReaderHarness()
  try {
    const directory = harness.reader.inspect().libraryDirectory!
    await chooseStudy(harness, harness.studyId)
    await rm(join(directory, 'recordings.v2', harness.studyId), {
      recursive: true,
    })
    const ledgerPath = join(directory, 'progress.repository.v4.json')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.beforeTrashMoves(async () => {
      await rm(ledgerPath, { recursive: true })
      await mkdir(join(ledgerPath, 'blocked'), { recursive: true })
    })
    // The Trash refuses only the first file, the catalog sidecar, and would take the archive: a removal that went on would leave that move in harness.trashMoves.
    harness.rejectTrashMoves((path) => path.endsWith('.study.meta.v3.json'))
    // Act
    await requestRemoval(harness, harness.studyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.studyRemoval?.status, 'failed')
    assert.match(
      view.studyRemoval?.text ?? '',
      new RegExp(
        `^The saved study could not be moved to the ${TRASH}\\. Nothing was deleted\\. Trash refused ${harness.studyId}\\.study\\.meta\\.v3\\.json; the learner ledger could not be written back: EISDIR`,
      ),
    )
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(
      view.studies.some((entry) => entry.id === harness.studyId),
      true,
    )
    assert.equal(view.model.selection.studyId, harness.studyId)
    assert.equal(harness.record.historyExcluded, undefined)
    assert.equal(harness.saveStatus.visible, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=after a removal the reader never keeps the removed study selected when a newer choice took over and then failed; fails_when=the overtaken neighbour returns without changing the selection, so later selection saves fail with "Study archive is unavailable."; why_new=the overtaken neighbour was only tested with a newer choice that opens; seam=the library's archive read, held and failed by the test
test('a newer choice that fails to open while the neighbour of a removed study is being read leaves the reader with no study selected', async (context) => {
  // Arrange: three studies; the middle one is shown and removed, the oldest is its neighbour, the newest is chosen meanwhile and cannot be read.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    let neighbourReadStarted!: () => void, releaseNeighbourRead!: () => void
    const started = new Promise<void>((resolve) => {
        neighbourReadStarted = resolve
      }),
      released = new Promise<void>((resolve) => {
        releaseNeighbourRead = resolve
      })
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === chosen.id) throw new Error('The chosen archive is damaged.')
        if (id === neighbour.id) {
          neighbourReadStarted()
          await released
        }
        return readCheckpoint.call(this, id)
      },
    )
    // Act
    const removal = requestRemoval(harness, removed.id)
    await started
    await sendChoice(harness, 'history', chosen.id)
    releaseNeighbourRead()
    await removal
    await readerSeams(harness).saveSelection()
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, undefined)
    assert.equal(view.studyRemoval?.status, 'moved')
    assert.equal((await library.readProgress()).selection?.studyId, undefined)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('unavailable')),
      ),
      [],
    )
    assert.deepEqual(
      structuredClone(view.errors.filter((line) => line.includes('damaged'))),
      ['Error: The chosen archive is damaged.'],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a study the learner chose and saw while a removal was reading the ledger stays the reader's study; fails_when=the removal decides before that read that the removed study is shown, and then replaces the newer choice with the neighbour; why_new=the existing tests choose while the neighbour is read or while files move; seam=the library's ledger read after the moves, held by the test
test('a saved study chosen and shown while a removal reads the ledger stays shown and saved, and the neighbour is never read', async (context) => {
  // Arrange: three studies; the middle one is shown and removed. The ledger read that follows its two file moves is held.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const readProgress = LearningLibrary.prototype.readProgress
    let ledgerReadStarted!: () => void, releaseLedgerRead!: () => void
    let heldOnce = false
    const started = new Promise<void>((resolve) => {
        ledgerReadStarted = resolve
      }),
      released = new Promise<void>((resolve) => {
        releaseLedgerRead = resolve
      })
    context.mock.method(
      LearningLibrary.prototype,
      'readProgress',
      async function (this: LearningLibrary) {
        if (harness.trashMoves.length === 2 && !heldOnce) {
          heldOnce = true
          ledgerReadStarted()
          await released
        }
        return readProgress.call(this)
      },
    )
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    const archiveReads: string[] = []
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      function (this: LearningLibrary, id: string) {
        archiveReads.push(id)
        return readCheckpoint.call(this, id)
      },
    )
    // Act
    const removal = requestRemoval(harness, removed.id)
    await started
    await sendChoice(harness, 'history', chosen.id)
    const shownBeforeRelease =
      harness.reader.inspect().view!.model.selection.studyId
    releaseLedgerRead()
    await removal
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(shownBeforeRelease, chosen.id)
    assert.equal(view.model.selection.studyId, chosen.id)
    assert.equal(view.study?.id, chosen.id)
    assert.equal((await library.readProgress()).selection?.studyId, chosen.id)
    assert.equal(archiveReads.includes(neighbour.id), false)
    assert.equal(view.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a Node test history the learner chose and saw while a study was being deleted stays shown; fails_when=the removal compares only the saved-study selection, which a Node test history never changes, and shows the neighbour over it; why_new=the existing Node test history case is still opening when the removal settles; seam=the editor's Trash, held by the test
test('a Node test history chosen and shown while a removal moves files stays shown, and the neighbour is never read', async (context) => {
  // Arrange: two saved studies and a Node test history; the shown study's removal is moving files when the history is chosen and shown.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    const archiveReads: string[] = []
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      function (this: LearningLibrary, id: string) {
        archiveReads.push(id)
        return readCheckpoint.call(this, id)
      },
    )
    const trashMove = harness.holdTrashMove()
    const removal = requestRemoval(harness, removed.id)
    await trashMove.started
    await sendChoice(harness, 'node-history', nodeHistory.studyId)
    const shownWhileMoving =
      harness.reader.inspect().view!.nodeHistory?.header.studyId
    // Act
    trashMove.release()
    await removal
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(shownWhileMoving, nodeHistory.studyId)
    assert.equal(view.nodeHistory?.header.studyId, nodeHistory.studyId)
    assert.equal(view.loading, false)
    assert.equal(view.model.selection.studyId, undefined)
    assert.equal(archiveReads.includes(neighbour.id), false)
    assert.equal((await library.readProgress()).selection?.studyId, undefined)
    assert.equal(view.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=deleting a saved study also takes the raw evidence of its run out of the extension's agent storage; fails_when=the reader names no evidence directory or a wrong one, so screenshots and sealed source stay behind; why_new=the removal did not know the evidence directory; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a confirmed removal also moves the raw evidence directory of the study’s run from the agent storage to the Trash', async () => {
  // Arrange: a saved study of an earlier session whose run left its evidence in the agent storage; that window has stopped, so no connection descriptor exists.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const evidenceDirectory = evidenceDirectoryOf(harness, study)
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(join(evidenceDirectory, 'events.jsonl'), '{"sequence":1}\n')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, study.id)
    // Assert
    assert.deepEqual(
      harness.trashMoves.map((move) => [
        move.path,
        structuredClone(move.options),
      ]),
      [
        [evidenceDirectory, { recursive: true, useTrash: true }],
        [
          join(
            harness.reader.inspect().libraryDirectory!,
            `${study.id}.study.meta.v3.json`,
          ),
          { recursive: true, useTrash: true },
        ],
        [
          join(
            harness.reader.inspect().libraryDirectory!,
            `${study.id}.study.v3.json`,
          ),
          { recursive: true, useTrash: true },
        ],
      ],
    )
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyRemoval),
      {
        status: 'moved',
        studyId: study.id,
        text: `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=evidence that another Codebook window may still be writing or serving stays where it is, and the learner is told; fails_when=the evidence of a run in another open window is moved away under it, or it is left without a word; why_new=the removal did not touch evidence before, and the check for a stopped run sees this window's runs only; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal leaves the raw evidence in place and says so while another Codebook window’s connection descriptor exists', async () => {
  // Arrange: the study's run belongs to another instance whose connection descriptor is still in the agent storage.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const evidenceDirectory = evidenceDirectoryOf(harness, study)
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(
      join(
        harness.directory,
        'storage',
        'agent',
        `${study.instanceId}.connection.json`,
      ),
      '{}',
    )
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, study.id)
    // Assert
    assert.deepEqual(
      harness.trashMoves.map((move) => basename(move.path)),
      [`${study.id}.study.meta.v3.json`, `${study.id}.study.v3.json`],
    )
    assert.deepEqual(await readdir(evidenceDirectory), [])
    assert.equal(
      harness.reader.inspect().view!.studyRemoval?.text,
      `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies. The run's raw evidence was left in place because its Codebook window may still be open.`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=deleting a saved study of a window of a build up to 0.2.28 that crashed also takes its raw evidence out of the agent storage; fails_when=a connection descriptor that names a process and no machine holds the evidence back for good, although its process has ended (Cycle 0046 row 10, PL-2); why_new=the removal tests wrote descriptors without a process id only; seam=the editor's dialog and Trash, stubbed at the vscode boundary, and a process id that no process has
test('a removal also moves the raw evidence of a crashed window whose connection descriptor names an ended process and no machine', async () => {
  // Arrange: the study's run belongs to another instance; that window crashed and left its descriptor, written by a build up to 0.2.28, in the agent storage.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const evidenceDirectory = evidenceDirectoryOf(harness, study)
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(
      join(
        harness.directory,
        'storage',
        'agent',
        `${study.instanceId}.connection.json`,
      ),
      JSON.stringify({ pid: ID_OF_NO_PROCESS }),
    )
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, study.id)
    // Assert
    assert.deepEqual(
      harness.trashMoves.map((move) => move.path),
      [
        evidenceDirectory,
        join(
          harness.reader.inspect().libraryDirectory!,
          `${study.id}.study.meta.v3.json`,
        ),
        join(
          harness.reader.inspect().libraryDirectory!,
          `${study.id}.study.v3.json`,
        ),
      ],
    )
    assert.equal(
      harness.reader.inspect().view!.studyRemoval?.text,
      `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the evidence of this window's own stopped run goes with its study although this window's connection descriptor exists, and the run then refuses to serve it; fails_when=the descriptor check also holds back this window's own runs, or the run keeps serving a directory that is gone; why_new=the descriptor check and the evidence refusal are new; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('the evidence of this window’s own stopped run moves with its study, and the run then answers that its evidence is unavailable', async () => {
  // Arrange: a recorded, stopped and saved run of this window; its evidence and this window's descriptor are in the agent storage.
  const harness = await recordedReaderHarness()
  try {
    const evidenceDirectory = evidenceDirectoryOf(harness, {
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
    })
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(
      join(
        harness.directory,
        'storage',
        'agent',
        `${harness.service.instanceId}.connection.json`,
      ),
      '{}',
    )
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, harness.studyId)
    // Assert
    assert.deepEqual(
      harness.trashMoves.slice(0, 2).map((move) => move.path),
      [
        join(
          harness.reader.inspect().libraryDirectory!,
          'recordings.v2',
          harness.studyId,
        ),
        evidenceDirectory,
      ],
    )
    assert.equal(
      harness.reader.inspect().view!.studyRemoval?.text,
      `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
    )
    assert.throws(
      () => harness.service.assertEvidenceAvailable(harness.record),
      new RegExp(`The learner moved this saved study to the ${TRASH}\\.`),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the files of a study move only after an explanation that was being written has landed, and no explanation is accepted while they move; fails_when=the removal starts while an explanation is still being written, or an explanation is accepted during the move and lands in a directory that is already in the Trash; why_new=the removal did not move the evidence directory before; seam=the evidence writer's save and the editor's Trash, both held by the test
test('a removal of this window’s run waits for an explanation that is being written and refuses another one while its files move', async () => {
  // Arrange: a recorded, stopped and saved run; the write of a late explanation is held.
  const harness = await recordedReaderHarness()
  try {
    const evidence = harness.runtimes[0]!.evidence,
      save = evidence.save.bind(evidence)
    const order: string[] = []
    let releaseWrite!: () => void
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    evidence.save = async (name, contents): Promise<void> => {
      order.push('explanation write started')
      await writeHeld
      await save(name, contents)
      order.push('explanation write finished')
    }
    const explanation = {
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      snapshotUri: harness.service.state(harness.record).participants.browser
        .snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'Explained while the learner deleted the study.',
    }
    const firstExplanation = harness.service.explain({
      ...explanation,
      key: 'in-flight',
    })
    await waitUntil(() => order.length === 1, 'the held explanation write')
    harness.rejectTrashMoves((path) => {
      order.push(`moved ${basename(path)}`)
      return false
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const trashMove = harness.holdTrashMove()
    // Act
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const movesBeforeWriteFinished = order.filter((step) =>
      step.startsWith('moved'),
    ).length
    releaseWrite()
    await trashMove.started
    let refusalWhileMoving = ''
    try {
      void harness.service.explain({ ...explanation, key: 'during-move' })
    } catch (error) {
      refusalWhileMoving = String(error)
    }
    trashMove.release()
    await removal
    await firstExplanation
    // Assert
    assert.equal(movesBeforeWriteFinished, 0)
    assert.deepEqual(order.slice(0, 3), [
      'explanation write started',
      'explanation write finished',
      `moved ${harness.studyId}`,
    ])
    assert.equal(
      refusalWhileMoving,
      "Error: The learner is deleting this run's saved study; wait for it to finish.",
    )
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that made room but left the storage lock in place names no next step that the lock would refuse; fails_when=the moved line says "Ask your editor agent to start the run again" while `writer.lock` stays (0040-D8); why_new=the next step was only tested with a released lock; seam=the editor's Trash, stubbed at the vscode boundary, from whose last move on the lock file can no longer be removed
test('a removal that makes room for a refused run but cannot release the storage lock names no next step and keeps the refusal line', async (context) => {
  // Arrange: a library full at one study, a run refused on it, and a Trash after whose last move the lock stays.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    const directory = harness.reader.inspect().libraryDirectory!
    harness.beforeTrashMoves(async (path) => {
      if (path.endsWith('.study.v3.json'))
        await refuseLockRelease(context, directory)
    })
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, earlier.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'moved',
      studyId: earlier.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 0 of 1 saved studies.`,
    })
    assert.equal(
      view.runRefusal,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved study the learner restored from the Trash is treated as a saved study again by the window that removed it, without a reload; fails_when=the window keeps the restored id as removed and drops its position saves (0038-F8); why_new=no test restored a removed study; seam=the editor's Trash, stubbed at the vscode boundary, whose moves the test puts back
test('a removed study restored from the Trash and listed again by Retry storage has its playback position saved again', async () => {
  // Arrange: the recording of the study was opened and left; the study is removed, its files are put back from the Trash, and Retry storage lists it again.
  const harness = await recordedReaderHarness()
  try {
    const directory = harness.reader.inspect().libraryDirectory!
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    const bundle = harness.controller.bundle()!
    await readerSeams(harness).receive(
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )
    await requestRemoval(harness, harness.studyId)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    for (const [index, move] of harness.trashMoves.entries())
      await rename(
        join(harness.directory, 'trash', `${index + 1}-${basename(move.path)}`),
        move.path,
      )
    // The restored position file is set aside, so only a new save can write one.
    await rm(join(directory, 'playback.v1.json'), { force: true })
    await harness.reader.action('retry')
    // Act
    await readerSeams(harness).savePlaybackPosition({
      ...bundle,
      studyId: harness.studyId,
    })
    // Assert
    assert.equal(
      harness.reader
        .inspect()
        .view!.studies.some((entry) => entry.id === harness.studyId),
      true,
    )
    const playback: unknown = JSON.parse(
      await readFile(join(directory, 'playback.v1.json'), 'utf8'),
    )
    assert.equal(
      playback && typeof playback === 'object' && 'studyId' in playback
        ? playback.studyId
        : undefined,
      harness.studyId,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=after the editor's Trash refused a removal, the next refusal of a full library tells the learner the remedy that works in this editor; fails_when=a refused removal leaves the refusal naming a deletion that cannot work here (0038-F9); why_new=the delete remedy was named whatever the Trash did; seam=the editor's Trash, stubbed at the vscode boundary, which refuses every move
test('after the Trash refused a removal, a run refused on the full library names only the limit setting', async () => {
  // Arrange: a library full at one study whose removal the Trash refuses.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    harness.rejectTrashMoves(() => true)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, earlier.id)
    // Act
    const refused = await startRun(harness)
    // Assert
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'failed')
    assert.equal(
      refused.record.error?.message,
      `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run; this editor could not move a saved study to the ${TRASH} in this session. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the remedy a full library names after a removal that another window's recording stopped before any move; fails_when=that refusal counts as a refusal of the Trash, so the next full library says "this editor could not move a saved study to the Trash in this session" and offers no deletion, although the Trash was never asked; why_new=Cycle 0046 review AF1: every outcome but a move counted as the Trash's refusal; seam=the recording's header and the record of its writer, which name a live child process of the test with its own start, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('after a removal refused because another window of this machine still records the study, a run refused on the full library still offers to delete a saved study', async (context: TestContext) => {
  // Arrange: a library full at one study, whose recording another live window of this machine still writes.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const otherWindow = await idleChild(context)
    await unsealedRecordingOf(
      harness,
      study,
      { pid: otherWindow.pid!, hostname: hostname() },
      'with-record',
    )
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, study.id)

    // Act
    const refused = await startRun(harness)

    // Assert
    assert.deepEqual(
      {
        removal: harness.reader.inspect().view!.studyRemoval?.status,
        moved: harness.trashMoves,
        refusal: refused.record.error?.message,
      },
      { removal: 'failed', moved: [], refusal: FULL_LIBRARY_REFUSAL },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the remedy a full library names after a removal of a study of which nothing was left by then; fails_when="Study archive is unavailable." counts as a refusal of the Trash, so the next full library offers no deletion, although the Trash was never asked; why_new=Cycle 0046 review AF1; seam=the library directory, from which the test removes one study's files by hand after the list showed it, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('after a removal refused because nothing was left of the study, a run refused on the full library still offers to delete a saved study', async () => {
  // Arrange: two saved studies and a limit of one; the first one's files are removed by hand after the list showed it.
  const harness = await workspaceHarness()
  try {
    const gone = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.setSavedStudyCapacity(1)
    const directory = harness.reader.inspect().libraryDirectory!
    await rm(join(directory, `${gone.id}.study.v3.json`))
    await rm(join(directory, `${gone.id}.study.meta.v3.json`))
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, gone.id)

    // Act
    const refused = await startRun(harness)

    // Assert
    assert.deepEqual(
      {
        removal: structuredClone(harness.reader.inspect().view!.studyRemoval),
        moved: harness.trashMoves,
        refusal: refused.record.error?.message,
      },
      {
        removal: {
          status: 'failed',
          studyId: gone.id,
          text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Study archive is unavailable.`,
        },
        moved: [],
        refusal: FULL_LIBRARY_REFUSAL,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a study a newer Codebook saved is shown with the sentence that says what to do, is no storage failure, and is not half deleted by a Codebook that does not know its files; fails_when=its note counts as an error Retry storage should answer, or a delete request opens the Trash dialog for it (RT-1, DX-15, PC-4.1); why_new=the reader never listed a newer format; seam=the library directory, into which the test writes a file as a newer Codebook would name it
test('a saved study in a newer format is listed with its note, adds no storage error and is refused when the learner asks to delete it', async () => {
  // Arrange: one saved study, saved again in format 5 by a newer Codebook.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await writeFile(
      join(
        harness.reader.inspect().libraryDirectory!,
        `${study.id}.study.v5.json`,
      ),
      JSON.stringify({ ...study, version: 5 }),
    )
    await harness.reader.action('retry')
    // Act
    await requestRemoval(harness, study.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(
      structuredClone(view.studies).map((entry) => [
        entry.id,
        entry.format,
        entry.reason,
      ]),
      [
        [
          study.id,
          'newer',
          'This study was saved in format 5 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.',
        ],
      ],
    )
    assert.equal(
      view.errors.some((line) => line.includes('newer Codebook')),
      false,
    )
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'refused',
      studyId: study.id,
      text: 'This study was saved by a newer Codebook and is kept as it is. Update the extension, then delete it there.',
    })
    assert.equal(harness.warningDialogs.length, 0)
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=after a rollback the reader still opens on a study it can read; fails_when=the reader tries to open the newest entry although a newer Codebook saved it, shows no study and reports its note as a storage failure (RT-1, PC-4.1); why_new=a newer format was never the first entry of the list; seam=the library directory, into which the test writes a file as a newer Codebook would name it, and a second reader over the same storage
test('a reader that starts with a study of a newer Codebook as its newest entry shows the newest study it can read, without a storage line', async () => {
  // Arrange: two saved studies and no saved selection; the newer of them was saved again in format 5, so the list shows it first.
  const harness = await workspaceHarness()
  try {
    const readable = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      savedAgainByNewer = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:02.000Z',
      )
    await writeFile(
      join(
        harness.reader.inspect().libraryDirectory!,
        `${savedAgainByNewer.id}.study.v5.json`,
      ),
      JSON.stringify({ ...savedAgainByNewer, version: 5 }),
    )
    const restarted = harness.createReader()
    try {
      // Act
      await restarted.learningStorage()
      // Assert
      const view = restarted.inspect().view!
      assert.equal(view.studies[0]?.id, savedAgainByNewer.id)
      assert.equal(view.studies[0]?.format, 'newer')
      assert.equal(view.model.selection.studyId, readable.id)
      assert.deepEqual(structuredClone(view.errors), [])
    } finally {
      await restarted.dispose()
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the pane that asked to delete a study is answered each time it asks, also when the answer has the words of the one before; fails_when=a second refusal with the same sentence equals the first, so it is not published and the pane's request stays unanswered (A-L5, AD-14); why_new=a refusal carried no field of its request; seam=none
test('a delete request refused twice with the same sentence is answered with each request’s own number', async () => {
  // Arrange: an open reader, and a study no catalog lists, so every delete request for it is refused with the same sentence.
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    const unlistedStudyId = `${randomUUID()}_${randomUUID()}`
    // Act
    await requestRemoval(harness, unlistedStudyId, 1)
    await requestRemoval(harness, unlistedStudyId, 2)
    // Assert: the answers as the Study pane received them, each state once.
    const answers = [
      ...new Set(
        harness
          .postedMessages()
          .flatMap((message) =>
            message.studyRemoval ? [JSON.stringify(message.studyRemoval)] : [],
          ),
      ),
    ].map((answer): unknown => JSON.parse(answer))
    assert.deepEqual(answers, [
      {
        status: 'refused',
        studyId: unlistedStudyId,
        text: 'Study archive is unavailable.',
        request: 1,
      },
      {
        status: 'refused',
        studyId: unlistedStudyId,
        text: 'Study archive is unavailable.',
        request: 2,
      },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the pane that asked to delete a study recognises its own removal from the dialog to the outcome; fails_when=a state of the removal is published without the number of the request that started it (A-L5, AD-14, DR-26); why_new=the removal states carried no field of their request; seam=the editor's confirmation dialog and Trash, stubbed at the vscode boundary
test('a removal the learner confirmed carries its request number while it is confirmed, while it moves and when it has moved', async () => {
  // Arrange: one saved study in an open reader; the learner will confirm the dialog.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, study.id, 7)
    // Assert: the states as the Study pane received them, each once.
    const states = [
      ...new Set(
        harness
          .postedMessages()
          .flatMap((message) =>
            message.studyRemoval
              ? [
                  JSON.stringify([
                    message.studyRemoval.status,
                    message.studyRemoval.request,
                  ]),
                ]
              : [],
          ),
      ),
    ].map((state): unknown => JSON.parse(state))
    assert.deepEqual(states, [
      ['confirming', 7],
      ['moving', 7],
      ['moved', 7],
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that worked never makes the next full-library refusal say that the Trash refused; fails_when=the last path of a removal decides the session's removal flag, so a rejection the library counts as moved hides the delete remedy (SM-8); why_new=the flag was only tested after a removal that failed; seam=the editor's Trash, stubbed at the vscode boundary, which rejects the archive after the test took it out of the library
test('after a removal that moved the study although the Trash rejected a path that was already gone, a run refused on the full library still names deleting a saved study', async () => {
  // Arrange: two saved studies under a limit of one; the Trash rejects the removed study's archive, its last path, after that file already left the library.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(2)
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.setSavedStudyCapacity(1)
    const isArchiveOfRemoved = (path: string): boolean =>
      basename(path) === `${removed.id}.study.v3.json`
    harness.beforeTrashMoves(async (path) => {
      if (isArchiveOfRemoved(path)) await rm(path)
    })
    harness.rejectTrashMoves(isArchiveOfRemoved)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, removed.id)
    // Act
    const refused = await startRun(harness)
    // Assert
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.equal(refused.record.error?.message, FULL_LIBRARY_REFUSAL)
  } finally {
    await harness.close()
  }
})

// Value: protects=in a window without a Trash the learner can still make room: the study's files are named, nothing is deleted by Codebook, and a refresh after the removal by hand shows the library as it is; fails_when=the delete request opens the Trash dialog and fails, or the reader keeps selecting the study that is gone, keeps the ledger's reference to it or keeps the refusal line (RT-7, DR-14, ER-12); why_new=a removal by hand was never followed by the reader; seam=the editor's remote name, and the file system, on which the test removes the listed files
test('after the listed files of a study were removed by hand, a refresh lists the library without it, leaves room for a run and drops the ledger’s reference to it', async () => {
  // Arrange: a WSL remote window; the one saved study fills the library, is shown, and a run was refused.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    harness.setSavedStudyCapacity(1)
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const refused = await startRun(harness)
    await waitUntil(() => refused.record.stopped, 'the end of the refused run')
    await chooseStudy(harness, earlier.id)
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    const selectionBefore = (await library.readProgress()).selection?.studyId
    // Act: the learner asks to delete the study, removes the files the answer lists, and presses Retry storage / refresh.
    await requestRemoval(harness, earlier.id, 1)
    const answer = structuredClone(harness.reader.inspect().view!.studyRemoval)
    const refusalLineBefore = harness.reader.inspect().view!.runRefusal
    for (const path of answer?.files ?? []) await rm(path, { recursive: true })
    await harness.reader.action('retry')
    const refusalLineAfterRefresh = harness.reader.inspect().view!.runRefusal
    const admitted = await startRun(harness)
    // Assert
    assert.equal(
      refused.record.error?.message,
      'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run; this window has no Trash, so Codebook cannot delete a saved study here. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.',
    )
    assert.deepEqual(answer, {
      status: 'refused',
      studyId: earlier.id,
      text: 'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.',
      files: [
        join(directory, `${earlier.id}.study.meta.v3.json`),
        join(directory, `${earlier.id}.study.v3.json`),
      ],
      request: 1,
    })
    assert.equal(harness.warningDialogs.length, 0)
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(selectionBefore, earlier.id)
    const view = harness.reader.inspect().view!
    assert.equal(view.removalWithoutTrash, true)
    assert.equal(
      view.studies.some((entry) => entry.id === earlier.id),
      false,
    )
    assert.notEqual(view.model.selection.studyId, earlier.id)
    assert.equal((await library.readProgress()).selection?.studyId, undefined)
    assert.equal(
      refusalLineBefore,
      'The last run did not start: Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run; this window has no Trash, so Codebook cannot delete a saved study here. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.',
    )
    assert.equal(refusalLineAfterRefresh, undefined)
    assert.equal(admitted.record.error, undefined)
    assert.equal(admitted.record.prepared, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=in a window without a Trash the learner who removed only some of a study's listed files and pressed Retry storage / refresh is shown the files that are left; fails_when=the reader keeps the list it made before the removal for a study the library still holds, so "Remove by hand" goes on showing paths that are gone, Copy paths copies them, and the pane never asks again because the reader still names files for that study; why_new=Cycle 0046 row 73 (the kept list was dropped only for a study that left the library); seam=the editor's remote name, and the file system, on which the test removes two of the three listed paths
test('in a window without a Trash, after two of a study’s three listed files were removed by hand, Retry storage / refresh forgets the list and the next request lists the one file that is left', async () => {
  // Arrange: a WSL remote window with a study an older Codebook saved (it cannot be opened, and Retry writes no catalog file for it again) and the raw evidence of its run; a request has listed its three paths.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    await harness.reader.learningStorage()
    const directory = harness.reader.inspect().libraryDirectory!,
      run = { instanceId: randomUUID(), runId: randomUUID() },
      studyId = `${run.instanceId}_${run.runId}`,
      evidenceDirectory = evidenceDirectoryOf(harness, run),
      catalogFile = join(directory, `${studyId}.study.meta.v2.json`),
      archive = join(directory, `${studyId}.study.v2.json`)
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(catalogFile, '{}')
    await writeFile(archive, '{}')
    await harness.reader.action('retry')
    await harness.reader.open()
    await requestRemoval(harness, studyId, 1)
    const listedBeforeRemoval = structuredClone(
      harness.reader.inspect().view!.studyFiles,
    )
    // Act: the learner removes the first two listed paths and presses Retry storage / refresh; the pane, whose open disclosure is named no files any more, asks again.
    await rm(evidenceDirectory, { recursive: true })
    await rm(catalogFile)
    await harness.reader.action('retry')
    const afterRetry = structuredClone({
      isStillListed: harness.reader
        .inspect()
        .view!.studies.some((entry) => entry.id === studyId),
      studyFiles: harness.reader.inspect().view!.studyFiles,
      hasRemovalAnswer:
        harness.reader.inspect().view!.studyRemoval !== undefined,
    })
    await requestRemoval(harness, studyId, 2)
    // Assert
    assert.deepEqual(listedBeforeRemoval, {
      [studyId]: [evidenceDirectory, catalogFile, archive],
    })
    assert.deepEqual(afterRetry, {
      isStillListed: true,
      studyFiles: {},
      hasRemovalAnswer: false,
    })
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.studyFiles), { [studyId]: [archive] })
    assert.deepEqual(structuredClone(view.studyRemoval), {
      status: 'refused',
      studyId,
      text: 'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.',
      files: [archive],
      request: 2,
    })
    assert.deepEqual(readerSeams(harness).errorLines(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner of a window without a Trash who removed a study's archive first and pressed Retry storage / refresh: the study is no longer shown or selected, no storage line appears, and what is left of it stays listed with its files so it can be removed; fails_when=the reader takes the entry the library now lists for the rest (`archive-missing`) for the study itself, keeps it selected and reports "Error: Study archive is unavailable." twice until the rest is removed; why_new=Cycle 0046 row 181 (measured by the library's fixer after row 86 listed such rests); seam=the editor's remote name, and the file system, on which the test removes the archive alone
test('in a window without a Trash, after the archive alone of the chosen study was removed by hand, Retry storage / refresh selects no study and shows no storage line, and what is left stays listed with its files until it is removed too', async () => {
  // Arrange: a WSL remote window with two saved studies; the older one is chosen and its two files are listed.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      other = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, study.id)
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!,
      catalogFile = join(directory, `${study.id}.study.meta.v3.json`)
    await requestRemoval(harness, study.id, 1)
    /** Reads what the reader shows of the study: its entry, whether it is selected in the reader and in the ledger, the storage lines and its listed files. */
    const shown = async () => {
      const view = harness.reader.inspect().view!
      const entry = view.studies.find((listed) => listed.id === study.id)
      return structuredClone({
        entry: entry && [entry.format, entry.metadata, entry.outcome],
        isSelected: view.model.selection.studyId === study.id,
        isSelectedInLedger:
          (await library.readProgress()).selection?.studyId === study.id,
        errorLines: readerSeams(harness).errorLines(),
        files: view.studyFiles?.[study.id],
      })
    }
    const listedWhole = await shown()
    // Act: the learner removes the archive alone and presses Retry storage / refresh; the pane asks for the files again; the learner removes what is left and presses Retry again.
    await rm(join(directory, `${study.id}.study.v3.json`))
    await harness.reader.action('retry')
    const afterArchiveRemoved = await shown()
    await requestRemoval(harness, study.id, 2)
    const restListed = await shown()
    await rm(catalogFile)
    await harness.reader.action('retry')
    const afterRestRemoved = await shown()
    // Assert
    assert.deepEqual(listedWhole, {
      entry: ['v3', 'validated', 'demonstrated'],
      isSelected: true,
      isSelectedInLedger: true,
      errorLines: [],
      files: [catalogFile, join(directory, `${study.id}.study.v3.json`)],
    })
    assert.deepEqual(afterArchiveRemoved, {
      entry: [
        'archive-missing',
        'unavailable',
        'Archive missing; remaining files kept',
      ],
      isSelected: false,
      isSelectedInLedger: false,
      errorLines: [],
      files: undefined,
    })
    assert.deepEqual(restListed, {
      entry: [
        'archive-missing',
        'unavailable',
        'Archive missing; remaining files kept',
      ],
      isSelected: false,
      isSelectedInLedger: false,
      errorLines: [],
      files: [catalogFile],
    })
    assert.deepEqual(afterRestRemoved, {
      entry: undefined,
      isSelected: false,
      isSelectedInLedger: false,
      errorLines: [],
      files: undefined,
    })
    assert.equal(
      harness.reader
        .inspect()
        .view!.studies.some((listed) => listed.id === other.id),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a reader that starts on a library whose newest entry, or whose saved selection, is what is left of a study without its archive: it opens on the newest study it can read, without a storage line; fails_when=the reader tries to read the rest, shows no study and reports "Error: Study archive is unavailable."; why_new=Cycle 0046 row 181; seam=a second reader over the same library, as after a restart of the editor
for (const [situation, isRestSelected] of [
  ['its newest entry', false],
  ['its saved selection', true],
] as const)
  test(`a reader that starts with what is left of a study without its archive as ${situation} shows the newest study it can read, without a storage line`, async () => {
    // Arrange: two saved studies; the newer one lost its archive by hand, and the ledger names it or no study.
    const harness = await workspaceHarness()
    try {
      const readable = await saveEarlierStudy(
          harness,
          '2026-09-20T00:00:01.000Z',
        ),
        rest = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
      if (isRestSelected) await chooseStudy(harness, rest.id)
      const library = await harness.reader.learningStorage()
      const selectedInLedger = (await library.readProgress()).selection?.studyId
      await rm(
        join(
          harness.reader.inspect().libraryDirectory!,
          `${rest.id}.study.v3.json`,
        ),
      )
      const restarted = harness.createReader()
      try {
        // Act
        await restarted.learningStorage()
        // Assert
        const view = restarted.inspect().view!
        assert.equal(selectedInLedger, isRestSelected ? rest.id : undefined)
        assert.deepEqual(
          structuredClone(view.studies).map((entry) => [
            entry.id,
            entry.format,
          ]),
          [
            [rest.id, 'archive-missing'],
            [readable.id, 'v3'],
          ],
        )
        assert.equal(view.model.selection.studyId, readable.id)
        assert.deepEqual(structuredClone(view.errors), [])
      } finally {
        await restarted.dispose()
      }
    } finally {
      await harness.close()
    }
  })

/**
 * Records one run of this window on a disk that refuses every study save and leaves it running, so a test chooses how the run is stopped.
 * @param context - The test whose mocks the caller restores.
 * @param harness - A harness with a deterministic clock, whose service records the run.
 * @returns The run, the id of its study, and `makeDiskWritable`, after which every study save reaches the disk.
 * @example
 * const unsaved = await recordRunOnRefusingDisk(context, harness)
 * await harness.reader.action('stop') // its last checkpoint is the save that fails
 */
async function recordRunOnRefusingDisk(context: TestContext, harness: Harness) {
  const saveStudy = LearningLibrary.prototype.saveStudy
  let isDiskWritable = false
  context.mock.method(
    LearningLibrary.prototype,
    'saveStudy',
    function (
      this: LearningLibrary,
      study: Parameters<LearningLibrary['saveStudy']>[0],
    ) {
      return isDiskWritable
        ? saveStudy.call(this, study)
        : Promise.reject(new Error('disk is read-only'))
    },
  )
  // A run records only for a build whose source is identified.
  harness.service.environment.build.sourceHash = sha256('recorded-build')
  harness.acknowledgeContext()
  harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: randomUUID(),
  })
  const record = [...harness.service.records.values()][0]!
  await record.preparation
  record.recording!.frame({
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
      'base64',
    ),
    elapsedMs: 20,
    kind: 'stream',
  })
  harness.clock(100)
  await harness.reader.action('click').catch(() => undefined)
  harness.clock(200)
  return {
    record,
    studyId: `${harness.service.instanceId}_${record.id}`,
    makeDiskWritable(): void {
      isDiskWritable = true
    },
  }
}

/**
 * Records one run of this window on a disk that refuses every study save ({@link recordRunOnRefusingDisk}), stops it with the Stop command and lets the reader list the library, so the reader is left with the run's archive unsaved ("History not saved: …") and the library with the run's recording alone.
 * @param context - The test whose mocks the caller restores.
 * @param harness - A harness with a deterministic clock, whose service records the run.
 * @returns The run, the id of its study, and `makeDiskWritable`, after which every study save reaches the disk.
 * @example
 * const unsaved = await stopRunOnRefusingDisk(context, harness)
 * unsaved.makeDiskWritable()
 * await harness.reader.action('retry') // writes the archive of unsaved.studyId
 */
async function stopRunOnRefusingDisk(context: TestContext, harness: Harness) {
  const unsaved = await recordRunOnRefusingDisk(context, harness)
  // Stop ends the run; its own checkpoint is the save that fails. What Stop itself answers is stated by the tests of Stop, not here.
  await harness.reader.action('stop').catch(() => undefined)
  await readerSeams(harness).refresh()
  return unsaved
}

// Value: protects=Retry storage / refresh saving the study of a stopped run whose archive could not be written: the button the learner is told to press writes the archive, and the run answers its history and evidence; fails_when=the reader takes the entry the library lists for the run's finished recording (it has no archive yet) for a study whose files were removed by hand, forgets the study with its pending archive and excludes the run, so the press discards the study and an agent reads that its files were removed by hand, or Retry writes the selection before the archive, so "Study archive is unavailable." is left by the press that saved the study; why_new=Cycle 0046 row 248 (row 181 counted every entry without an archive as removed), rows 266 and 280 (no line is left); seam=the library's study save, which fails until the disk is writable again
test('after the archive of a stopped run could not be saved, Retry storage / refresh writes it, lists the study and lets an agent read the run’s history and evidence; the study is not taken for one whose files were removed by hand', async (context) => {
  // Arrange: a recorded run of this window whose every archive save fails; it is stopped, and the library lists what exists of it: its recording.
  const harness = await workspaceHarness(true, true)
  try {
    const { record, studyId, makeDiskWritable } = await stopRunOnRefusingDisk(
        context,
        harness,
      ),
      library = await harness.reader.learningStorage(),
      archive = join(
        harness.reader.inspect().libraryDirectory!,
        `${studyId}.study.v3.json`,
      )
    const beforeRetry = structuredClone({
      listed: (await library.list()).map((entry) => [entry.id, entry.format]),
      errorLines: readerSeams(harness).errorLines(),
      history: harness.service.state(record).historyOutcome.status,
    })
    // Act: the learner presses Retry storage / refresh while the disk still refuses, which lists the library again, and once more when the disk is writable; an agent reads the run and its events.
    await harness.reader.action('retry')
    const historyAfterFailedRetry =
      harness.service.state(record).historyOutcome.status
    makeDiskWritable()
    await harness.reader.action('retry')
    const run = await readResource(
      harness.service,
      harness.service.uri(record.id),
    )
    const events = await readResource(
      harness.service,
      harness.service.uri(record.id, 'events/0'),
    ).then(
      () => 'answered',
      (error: unknown) =>
        error instanceof StudyError ? [error.code, error.message] : error,
    )
    // Assert
    assert.deepEqual(beforeRetry, {
      listed: [[studyId, 'archive-missing']],
      // One line: Stop tells the failure of its own checkpoint in the archive's line (row 280).
      errorLines: ['Error: History not saved: Error: disk is read-only'],
      history: 'failed',
    })
    assert.equal(historyAfterFailedRetry, 'failed')
    assert.deepEqual(
      (await library.list()).map((entry) => [
        entry.id,
        entry.format,
        entry.metadata,
      ]),
      [[studyId, 'v3', 'validated']],
    )
    assert.equal((await readFile(archive)).length > 0, true)
    assert.ok('text' in run)
    assert.equal(JSON.parse(run.text).historyOutcome.status, 'saved')
    assert.equal(events, 'answered')
    // No line at all is left by the Retry that saved the study: neither "Study archive is unavailable." for the selection (row 266) nor a control line of Stop (row 280).
    assert.deepEqual(readerSeams(harness).errorLines(), [])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the one press on Retry storage / refresh that saves the study of a stopped run the reader shows: the pane is left without any line; fails_when=Retry writes the reader's selection before the archive the selection names, so the selection fails with "Study archive is unavailable." and the pane shows that line for the study the same press saved, until Retry is pressed once more, or Stop tells the failure of its checkpoint a second time as a control line, which no Retry retires; why_new=Cycle 0046 row 266 (seen in the test of row 248, older than that row) and row 280 (no line at all); seam=the library's study save, which fails until the disk is writable again
test('after the archive of a stopped run could not be saved, the one press on Retry storage / refresh that writes it leaves no storage line, not “Study archive is unavailable.” for the study it just saved', async (context) => {
  // Arrange: a stopped run of this window whose archive could not be saved; the reader follows that run, so its selection names the unsaved study.
  const harness = await workspaceHarness(true, true)
  try {
    const unsaved = await stopRunOnRefusingDisk(context, harness),
      library = await harness.reader.learningStorage()
    const beforeRetry = structuredClone({
      isUnsavedStudySelected:
        harness.reader.inspect().view!.model.selection.studyId ===
        unsaved.studyId,
      errorLines: readerSeams(harness).errorLines(),
    })
    unsaved.makeDiskWritable()
    // Act: the learner presses Retry storage / refresh once.
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(beforeRetry, {
      isUnsavedStudySelected: true,
      // One line: Stop tells the failure of its own checkpoint in the archive's line (row 280).
      errorLines: ['Error: History not saved: Error: disk is read-only'],
    })
    assert.deepEqual(
      (await library.list()).map((entry) => [entry.id, entry.format]),
      [[unsaved.studyId, 'v3']],
    )
    const view = harness.reader.inspect().view!
    // No line at all is left (rows 266 and 280).
    assert.deepEqual(structuredClone(view.errors), [])
    assert.equal(view.unretryableErrorCount, 0)
    // The same press wrote the selection that names the study.
    assert.equal(
      (await library.readProgress()).selection?.studyId,
      unsaved.studyId,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the learner who stops a run while the library cannot be written reading one line about it, the one Retry storage / refresh answers, and no line once Retry saved the study; fails_when=the failure of Stop's own checkpoint is thrown on as a refused control, so Stop fails although the run stopped, and the pane shows "Error: disk is read-only" beside "History not saved: …" and keeps it, without a Retry button, after the Retry that saved the study; why_new=Cycle 0046 row 280 (seen in the tests of rows 248 and 266); seam=the library's study save, which fails until the disk is writable again
test('a Stop whose last checkpoint cannot be written stops the run without failing and tells it once, in the line “History not saved: …” that Retry storage / refresh answers, and the Retry that saves the study leaves no line', async (context) => {
  // Arrange: a run recorded on a disk that refuses every study save.
  const harness = await workspaceHarness(true, true)
  try {
    const unsaved = await recordRunOnRefusingDisk(context, harness)
    // Act: the learner runs Stop, and presses Retry storage / refresh once the disk is writable.
    const stop = await harness.reader.action('stop').then(
      () => 'stopped',
      (error: unknown) => String(error),
    )
    const afterStop = structuredClone({
      isStopped: unsaved.record.stopped,
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    unsaved.makeDiskWritable()
    await harness.reader.action('retry')
    // Assert
    assert.equal(stop, 'stopped')
    assert.deepEqual(afterStop, {
      isStopped: true,
      errors: ['Error: History not saved: Error: disk is read-only'],
      // Retry storage / refresh is offered beside the one line.
      unretryableErrorCount: 0,
    })
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.equal(
      harness.service.state(unsaved.record).historyOutcome.status,
      'saved',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a Stop whose last checkpoint fails before anything is written (a capture that changed under it): the run is stopped, the Stop command does not fail, and the learner reads a line that Retry storage / refresh answers; fails_when=that failure is left to a control line alone, "Error: Final study changed during checkpoint; history was not certified.", which offers no Retry and stays until the next choice, or Stop rejects although the run stopped; why_new=Cycle 0046 row 280 (the failures of Stop's checkpoint that write no archive line of their own); seam=the reader's checkpoint step, replaced so that the forced checkpoint of Stop fails as a capture does
test('a Stop whose last checkpoint fails before anything is written stops the run without failing and tells it in the line “History not saved: …” that Retry storage / refresh answers, not in a control line', async () => {
  // Arrange: a running run whose forced checkpoint fails the way a capture that changed under it does.
  const harness = await workspaceHarness()
  try {
    const { record } = await startRun(harness)
    const checkpoint = readerSeams(harness).checkpointStep
    let isCaptureChanging = true
    readerSeams(harness).checkpointStep = async (
      service,
      run,
      force,
    ): Promise<void> => {
      // Only the forced checkpoint of Stop fails; the ones after it are the reader's own.
      if (force && isCaptureChanging) {
        isCaptureChanging = false
        throw new Error(
          'Final study changed during checkpoint; history was not certified.',
        )
      }
      return checkpoint(service, run, force)
    }
    // Act: the learner runs Stop, and then presses Retry storage / refresh.
    const stop = await harness.reader.action('stop').then(
      () => 'stopped',
      (error: unknown) => String(error),
    )
    const afterStop = structuredClone({
      isStopped: record.stopped,
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    await harness.reader.action('retry')
    // Assert
    assert.equal(stop, 'stopped')
    assert.deepEqual(afterStop, {
      isStopped: true,
      errors: [
        'Error: History not saved: Error: Final study changed during checkpoint; history was not certified.',
      ],
      // Retry storage / refresh is offered beside the one line.
      unretryableErrorCount: 0,
    })
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.equal(harness.service.state(record).historyOutcome.status, 'saved')
  } finally {
    await harness.close()
  }
})

/**
 * Makes every save of a study fail on the reader's library while `refusesEveryStudy` is set, and afterwards the saves of the studies named in `refusedStudyIds`; every other save reaches the disk.
 * @param context - The test whose mocks the caller restores.
 * @returns The switch and the set a test changes as the disk recovers.
 * @example
 * const disk = refuseStudySaves(context)
 * disk.refusesEveryStudy = false
 * disk.refusedStudyIds.add(firstStudyId) // only that study still cannot be saved
 */
function refuseStudySaves(context: TestContext) {
  const saveStudy = LearningLibrary.prototype.saveStudy
  const disk = { refusesEveryStudy: true, refusedStudyIds: new Set<string>() }
  context.mock.method(
    LearningLibrary.prototype,
    'saveStudy',
    function (
      this: LearningLibrary,
      study: Parameters<LearningLibrary['saveStudy']>[0],
    ) {
      return disk.refusesEveryStudy || disk.refusedStudyIds.has(study.id)
        ? Promise.reject(new Error('disk is read-only'))
        : saveStudy.call(this, study)
    },
  )
  return disk
}

// Value: protects=the line "History not saved: …" and the Retry button beside it while a study still waits to be saved, also when another study is saved meanwhile; fails_when=the successful save of one study retires the archive line although the archive of another study still waits, so the pane offers no Retry while a study is unsaved; why_new=Cycle 0046 row 300 (read in the code while working on row 278); seam=the library's study save, which refuses the first study only once the disk writes again, and the reader's own refresh, which saves the second run
test('the line “History not saved: …” of a study that still waits stays, with Retry storage / refresh beside it, when another study is saved meanwhile, and is gone once Retry wrote the waiting one', async (context) => {
  // Arrange: the study of a first, stopped run could not be saved. The disk writes again, but not that study, and a second run of the same server has started.
  const disk = refuseStudySaves(context)
  const harness = await workspaceHarness()
  try {
    const first = await startRun(harness)
    await harness.reader.action('stop')
    disk.refusesEveryStudy = false
    disk.refusedStudyIds.add(`${harness.service.instanceId}_${first.record.id}`)
    const second = await startRun(harness)
    // Act: the reader's refresh saves the second run's study; then the disk writes every study and the learner presses Retry storage / refresh.
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(second.record).historyOutcome.status === 'saved',
      'the save of the second run',
      1_000,
    )
    const afterOtherSave = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    disk.refusedStudyIds.clear()
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(afterOtherSave, {
      queued: 1,
      errors: ['Error: History not saved: Error: disk is read-only'],
      // Retry storage / refresh is still offered.
      unretryableErrorCount: 0,
    })
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.equal(
      harness.service.state(first.record).historyOutcome.status,
      'saved',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line "History not saved: …" and the Retry button beside it for a study whose last checkpoint failed before any write (its capture failed, so no archive waits for it), also when another study is saved meanwhile; fails_when=the successful save of the second study retires the line because no archive waits, so the learner loses the line and its Retry although the first study is unsaved; why_new=Cycle 0048 task 64 (CodeRabbit: the line was cleared by another study's save); seam=the capture step ({@link captureStudy}), which fails for the first study until the learner presses Retry, and the reader's refresh, which saves the second run; no_claim=a second study whose capture fails too, and a capture that fails again on Retry
test('the line “History not saved: …” of a study whose capture failed before any write stays, with Retry storage / refresh beside it, when another study is saved meanwhile, and is gone once Retry saved that study', async (context) => {
  // Arrange: the checkpoint of a first, stopped run fails in its capture, so the study never waits in the write queue; a second run of the same server has started.
  const capture = captureStudyModule.captureStudy
  let failedStudyId: string | undefined
  context.mock.method(
    captureStudyModule,
    'captureStudy',
    (...args: Parameters<typeof capture>) =>
      failedStudyId === `${args[0].instanceId}_${args[1].id}`
        ? Promise.reject(new Error('capture is unavailable'))
        : capture(...args),
  )
  const harness = await workspaceHarness()
  try {
    const first = await startRun(harness)
    failedStudyId = `${harness.service.instanceId}_${first.record.id}`
    await harness.reader.action('stop')
    const second = await startRun(harness)
    // Act: the reader's refresh saves the second run's study; then the capture works again and the learner presses Retry storage / refresh.
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(second.record).historyOutcome.status === 'saved',
      'the save of the second run',
      1_000,
    )
    const afterOtherSave = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    failedStudyId = undefined
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(afterOtherSave, {
      queued: 0,
      errors: ['Error: History not saved: Error: capture is unavailable'],
      // Retry storage / refresh is still offered.
      unretryableErrorCount: 0,
    })
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.equal(
      harness.service.state(first.record).historyOutcome.status,
      'saved',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line "History not saved: …" and the Retry button beside it when a run that started while Retry storage / refresh was under way could not be saved, although every step of that Retry succeeded and the Retry saved the study that had failed before; fails_when=the Retry takes the line from the pane after its steps although another study waits in the write queue, so the learner reads no failure and has no Retry for a study that is unsaved; why_new=Cycle 0048 task 96 (second /ship, coverage audit of the Retry block that retires the line only when no history is unsaved); seam=the library's reconcile, which the test holds so that a second run starts and its first save is refused during the Retry, and the library's study save, which refuses that run's study only; no_claim=a study that moves to the Trash during the Retry
test('a Retry storage / refresh that saved the earlier study keeps the line “History not saved: …” and Retry beside it when a run that started during the Retry could not be saved', async (context) => {
  // Arrange: the study of a first, stopped run could not be saved, so the line shows. The disk writes again, but not the study of a second run that has not started yet.
  const disk = refuseStudySaves(context)
  const reconcile = LearningLibrary.prototype.reconcile
  let holdsReconcile = true
  let reachReconcile: () => void = () => undefined
  let continueReconcile: () => void = () => undefined
  const reconcileReached = new Promise<void>((resolve) => {
    reachReconcile = resolve
  })
  const reconcileMayContinue = new Promise<void>((resolve) => {
    continueReconcile = resolve
  })
  context.mock.method(
    LearningLibrary.prototype,
    'reconcile',
    async function (this: LearningLibrary) {
      if (holdsReconcile) {
        holdsReconcile = false
        reachReconcile()
        await reconcileMayContinue
      }
      return reconcile.call(this)
    },
  )
  const harness = await workspaceHarness()
  try {
    const first = await startRun(harness)
    await harness.reader.action('stop')
    readerSeams(harness).stopOwnTimer()
    disk.refusesEveryStudy = false
    // Act: the learner presses Retry storage / refresh. After its write of the first study, while it reconciles the library, a second run starts and the reader's refresh cannot save it.
    const retry = harness.reader.action('retry')
    await reconcileReached
    const second = await startRun(harness)
    disk.refusedStudyIds.add(
      `${harness.service.instanceId}_${second.record.id}`,
    )
    await readerSeams(harness).refresh()
    continueReconcile()
    await retry
    const afterRetry = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    disk.refusedStudyIds.clear()
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(afterRetry, {
      queued: 1,
      // The line of the second run's refused save, and the one line of the selection, which follows the second run and cannot read an archive that does not exist (one cause, one line: Cycle 0048 task 98). Retry storage / refresh answers both.
      errors: [
        'Error: History not saved: Error: disk is read-only',
        'Error: Study archive is unavailable.',
      ],
      // Retry storage / refresh is still offered.
      unretryableErrorCount: 0,
    })
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.equal(
      harness.service.state(first.record).historyOutcome.status,
      'saved',
    )
    assert.equal(
      harness.service.state(second.record).historyOutcome.status,
      'saved',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=one line for one failure after Retry storage / refresh when the selection names a study that has no archive: the learner reads "Study archive is unavailable." once, beside "History not saved: …", and Retry stays offered; fails_when=the Retry's read of the selected archive and its save of the selection both fail with the one sentence and both lines stay, so the pane shows the sentence twice for one cause; why_new=Cycle 0048 task 98 (maintainability, testing: task 96's test pinned the doubled sentence; Cycle 0046 row 181 counted that doubling as a defect); seam=the library's reconcile, which the test holds so that a second run starts and its save is refused during the Retry, and the library's study save, which refuses that run's study only; no_claim=which line kind carries the sentence
test('a Retry storage / refresh whose selection names a study without an archive shows “Study archive is unavailable.” once and keeps Retry offered', async (context) => {
  // Arrange: the study of a first, stopped run is unsaved; the disk writes again, but not the study of a second run that starts during the Retry, so the selection follows a study that has no archive.
  const disk = refuseStudySaves(context)
  const reconcile = LearningLibrary.prototype.reconcile
  let holdsReconcile = true
  let reachReconcile: () => void = () => undefined
  let continueReconcile: () => void = () => undefined
  const reconcileReached = new Promise<void>((resolve) => {
    reachReconcile = resolve
  })
  const reconcileMayContinue = new Promise<void>((resolve) => {
    continueReconcile = resolve
  })
  context.mock.method(
    LearningLibrary.prototype,
    'reconcile',
    async function (this: LearningLibrary) {
      if (holdsReconcile) {
        holdsReconcile = false
        reachReconcile()
        await reconcileMayContinue
      }
      return reconcile.call(this)
    },
  )
  const harness = await workspaceHarness()
  try {
    await startRun(harness)
    await harness.reader.action('stop')
    readerSeams(harness).stopOwnTimer()
    disk.refusesEveryStudy = false
    // Act
    const retry = harness.reader.action('retry')
    await reconcileReached
    const second = await startRun(harness)
    disk.refusedStudyIds.add(
      `${harness.service.instanceId}_${second.record.id}`,
    )
    await readerSeams(harness).refresh()
    continueReconcile()
    await retry
    // Assert
    assert.deepEqual(
      structuredClone({
        errors: harness.reader.inspect().view!.errors,
        unretryableErrorCount:
          harness.reader.inspect().view!.unretryableErrorCount,
      }),
      {
        errors: [
          'Error: History not saved: Error: disk is read-only',
          'Error: Study archive is unavailable.',
        ],
        unretryableErrorCount: 0,
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line and the Retry button while one of two studies whose saves failed is still unsaved after a Retry that wrote the other; fails_when=the Retry that wrote one study leaves no line although the other still waits; why_new=Cycle 0046 row 300 (the row's own order of events; it holds without the row's change as well, because Retry tries every waiting archive in turn and tells the failure of the second again); seam=the library's study save, which refuses one study by its id
test('a Retry storage / refresh that writes one of two studies whose saves failed leaves the line and Retry for the other, and the Retry that writes that one leaves no line', async (context) => {
  // Arrange: the studies of two stopped runs of one server could not be saved.
  const disk = refuseStudySaves(context)
  const harness = await workspaceHarness()
  try {
    const first = await startRun(harness)
    await harness.reader.action('stop')
    const second = await startRun(harness)
    await harness.reader.action('stop')
    const queuedBeforeRetry = readerSeams(harness).queuedStudyWrites()
    // Act: the disk writes the first study only, and the learner presses Retry storage / refresh; then it writes both, and the learner presses again.
    disk.refusesEveryStudy = false
    disk.refusedStudyIds.add(
      `${harness.service.instanceId}_${second.record.id}`,
    )
    await harness.reader.action('retry')
    const afterFirstRetry = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      histories: [first.record, second.record].map(
        (record) => harness.service.state(record).historyOutcome.status,
      ),
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    disk.refusedStudyIds.clear()
    await harness.reader.action('retry')
    // Assert
    assert.equal(queuedBeforeRetry, 2)
    assert.deepEqual(afterFirstRetry, {
      queued: 1,
      histories: ['saved', 'failed'],
      // The line of the Retry whose second write failed (the sentence of {@link persistArchive}), and the line of the selection, which names the second study and cannot be written before its archive exists. Retry storage / refresh answers both.
      errors: [
        'Error: History not saved: Error: disk is read-only',
        'Error: Study archive is unavailable.',
      ],
      unretryableErrorCount: 0,
    })
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.equal(
      harness.service.state(second.record).historyOutcome.status,
      'saved',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the one sentence "History not saved: …" the learner reads on the History not saved line after a Retry storage / refresh whose write of a waiting archive fails; fails_when=the Retry's catch reports the failed write again with the bare error text, so the line that {@link persistArchive} worded loses "History not saved:" and reads "Error: disk is read-only"; why_new=Cycle 0048 task 61 (OCR A, CodeRabbit: the Retry and the retirement reported the bare text); seam=the library's study save, which fails until the disk is writable again, and the reader's error lines; no_claim=the line of the selection ("Study archive is unavailable.") beside it
test('a Retry storage / refresh whose write of a waiting archive fails shows the line “History not saved: …” once, with its sentence', async (context) => {
  // Arrange: a stopped run of this window whose archive could not be saved; the disk still refuses.
  const harness = await workspaceHarness(true, true)
  try {
    await stopRunOnRefusingDisk(context, harness)
    // Act: the learner presses Retry storage / refresh while the disk refuses.
    await harness.reader.action('retry')
    // Assert: one History not saved line with its sentence once; the selection's own line is another kind.
    const lines = readerSeams(harness).errorLines()
    assert.deepEqual(lines, [
      'Error: History not saved: Error: disk is read-only',
      'Error: Study archive is unavailable.',
    ])
    assert.equal(readerSeams(harness).hasErrorOfKind('history-not-saved'), true)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the one sentence "History not saved: …" the learner reads after the retirement of a reader whose final write of a study fails; fails_when=the retirement reports the failed write with the bare error text over the sentence that {@link persistArchive} worded, so the line reads "Error: disk is read-only"; why_new=Cycle 0048 task 61 (OCR A, CodeRabbit: the retirement reported the bare text); seam=the library's study save, which fails until the disk is writable again, and the reader's error lines; no_claim=what the retirement rejects with (the tests of the hand-over state it)
test('the retirement of a reader whose last write of a study fails leaves the line “History not saved: …” with its sentence', async (context) => {
  // Arrange: a stopped run whose archive could not be saved, the disk still refusing.
  const harness = await workspaceHarness(true, true)
  try {
    await stopRunOnRefusingDisk(context, harness)
    // Act: the reader is retired, which writes the final history of its run again.
    const retirement = await harness.reader.retire(harness.service).then(
      () => 'retired',
      (error: unknown) => String(error),
    )
    // Assert
    assert.equal(
      retirement,
      'Error: Runtime released; final reader history was not saved: Error: disk is read-only',
    )
    assert.deepEqual(
      readerSeams(harness)
        .errorLines()
        .filter((line) => line.includes('disk is read-only')),
      ['Error: History not saved: Error: disk is read-only'],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

/**
 * Leaves a reader with the archive of a stopped run that could not be saved and whose server has ended, listed in Saved studies as what exists of it, and starts the learner's confirmed removal of that study with the Trash holding its first move and refusing every move.
 * Only the reader's waiting archive can still save such a study: no service holds its run any more, so Retry storage / refresh has no run to capture again.
 * @param context - The test whose mocks the caller restores.
 * @param harness - A harness with a deterministic clock.
 * @returns The unsaved run ({@link stopRunOnRefusingDisk}), the removal in progress, and `refuseTheMove`, which lets the held move go on to its refusal.
 * @example
 * const held = await removeUnsavedStudyOnRefusingTrash(context, harness)
 * held.refuseTheMove()
 * await held.removal // => the removal failed and nothing was deleted
 */
async function removeUnsavedStudyOnRefusingTrash(
  context: TestContext,
  harness: Harness,
) {
  const unsaved = await stopRunOnRefusingDisk(context, harness)
  await harness.reader.retire(harness.service).catch(() => undefined)
  // A Retry storage / refresh on the disk that still refuses lists what exists of the study.
  await harness.reader.action('retry')
  harness.answerWarningDialogs(async ([confirm]) => confirm)
  harness.rejectTrashMoves(() => true)
  const heldMove = harness.holdTrashMove()
  const removal = requestRemoval(harness, unsaved.studyId)
  await heldMove.started
  return { unsaved, removal, refuseTheMove: heldMove.release }
}

// Value: protects=the line "History not saved: …" and Retry storage / refresh for a study whose archive still waits when the learner presses Retry while that study is on its way to the Trash and the Trash then refuses the move; fails_when=the Retry ends during the move, skips the archive that is held back and retires the line, and nothing brings the line back when the move fails, so a study is unsaved without a line and without Retry; why_new=Cycle 0046 row 313 (read in the code while working on row 300; this is the row's own order of events, and it holds without a change: the Retry waits for the move, which holds the library's storage lock, and then tries the archive itself); seam=the fake editor's Trash, which holds and then refuses the move, and the library's study save, which fails until the disk is writable again
test('a Retry storage / refresh pressed while a study whose archive still waits is on its way to the Trash does not retire the line during the move, and when the Trash refuses the move the line and Retry are there for the archive that still waits', async (context) => {
  // Arrange: the learner deletes the study of a stopped run whose archive could not be saved and whose server has ended; the Trash holds the move.
  const harness = await workspaceHarness(true, true)
  try {
    const { unsaved, removal, refuseTheMove } =
      await removeUnsavedStudyOnRefusingTrash(context, harness)
    // Act: the learner presses Retry storage / refresh during the move; the Trash refuses the move; the disk writes again and the learner presses Retry once more.
    let hasRetryEnded = false
    const retry = harness.reader.action('retry').finally(() => {
      hasRetryEnded = true
    })
    // A Retry that does not wait for the move has ended long before this.
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    const duringTheMove = structuredClone({
      hasRetryEnded,
      removal: harness.reader.inspect().view!.studyRemoval?.status,
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
    })
    refuseTheMove()
    await removal
    await retry
    const afterTheRefusedMove = structuredClone({
      removal: harness.reader.inspect().view!.studyRemoval?.status,
      queued: readerSeams(harness).queuedStudyWrites(),
      selected: harness.reader.inspect().view!.model.selection.studyId,
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    unsaved.makeDiskWritable()
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(duringTheMove, {
      hasRetryEnded: false,
      removal: 'moving',
      queued: 1,
      // The archive's line of the Retry before the removal, and the line of the selection, which names the unsaved study.
      errors: [
        'Error: History not saved: Error: disk is read-only',
        'Error: Study archive is unavailable.',
      ],
    })
    assert.deepEqual(afterTheRefusedMove, {
      removal: 'failed',
      queued: 1,
      // The study stays selected: its archive waits in this reader, whose server has ended, so it is not one whose files were removed by hand (row 357).
      selected: unsaved.studyId,
      // The Retry tried the archive once the move had ended: its line, with Retry storage / refresh beside it, and the selection's line as before the press, because the selected study still has no archive.
      errors: [
        'Error: History not saved: Error: disk is read-only',
        'Error: Study archive is unavailable.',
      ],
      unretryableErrorCount: 0,
    })
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      unsaved.studyId,
    )
    assert.deepEqual(structuredClone(harness.reader.inspect().view!.errors), [])
    assert.deepEqual(
      (await (await harness.reader.learningStorage()).list()).map((entry) => [
        entry.id,
        entry.format,
      ]),
      [[unsaved.studyId, 'v3']],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line "History not saved: …" and Retry storage / refresh for an archive a removal held back, when that removal moved nothing: the reader tries the archive by itself, and a write that still fails is told again, also when the line was retired while the files were moving; fails_when=a removal that moved nothing leaves the archive it held back unwritten and untold, so a study is unsaved without a line and without Retry until something else writes it; why_new=Cycle 0046 row 313 (what brings the line back by itself when the move fails); seam=the fake editor's Trash, which holds and then refuses the move, the reader's archive line dropped during the move as the Retry action's last step drops it, and the library's study save, which fails
test('a removal that moved nothing tries the archive it held back by itself, and when that write still fails the line “History not saved: …” and Retry storage / refresh are there again, also when the line was retired during the move', async (context) => {
  // Arrange: the learner deletes the study of a stopped run whose archive could not be saved and whose server has ended; the Trash holds the move, and the archive's line is retired meanwhile.
  const harness = await workspaceHarness(true, true)
  try {
    const { removal, refuseTheMove } = await removeUnsavedStudyOnRefusingTrash(
      context,
      harness,
    )
    readerSeams(harness).dropErrorOfKind('archive')
    const hadArchiveLineDuringTheMove =
      readerSeams(harness).hasErrorOfKind('archive')
    // Act: the Trash refuses the move.
    refuseTheMove()
    await removal
    await waitUntil(
      () => readerSeams(harness).hasErrorOfKind('archive'),
      'the line of the archive that was held back',
      1_000,
    ).catch(() => undefined)
    // Assert
    assert.equal(hadArchiveLineDuringTheMove, false)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'failed')
    assert.equal(readerSeams(harness).queuedStudyWrites(), 1)
    const view = harness.reader.inspect().view!
    // The archive's line, written again by the reader itself. (The selection's line of before is gone: a removal that moved nothing reads the ledger again, and it could be read.)
    assert.deepEqual(structuredClone(view.errors), [
      'Error: History not saved: Error: disk is read-only',
    ])
    assert.equal(view.unretryableErrorCount, 0)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the study of a stopped run whose archive could not be saved when a new reader is attached to the same service: Retry storage / refresh in the new reader saves the study, and it opens; fails_when=the new reader no longer captures the run again from the service, so the archive that waits in the disposed reader is the only copy of the study, or the new reader takes the run's recording without an archive for a study removed by hand; either way the press writes nothing and the study can no longer be saved; why_new=Cycle 0046 row 267 (named while working on row 248, not stated by a test until now; the extension stops its service before it replaces its reader after a change of the workspace's folders, so the product attaches no second reader to a living service today, and this states what holds if it ever does); seam=the workspace harness's createReader (a second reader from the same loaded module, attached to the same service) and the library's study save, which fails until the disk is writable again
test('after the archive of a stopped run could not be saved, a reader made again over the same service writes it at Retry storage / refresh without the archive the disposed reader held, and the study opens with the run’s history saved', async (context) => {
  // Arrange: a stopped run whose archive waits in the reader that could not save it; that reader is disposed and a new one is attached to the same service.
  const harness = await workspaceHarness(true, true)
  let replacement: ReturnType<typeof harness.createReader> | undefined
  try {
    const unsaved = await stopRunOnRefusingDisk(context, harness)
    const queuedInDisposedReader = readerSeams(harness).queuedStudyWrites()
    await harness.reader.dispose()
    replacement = harness.createReader()
    const successor = { reader: replacement }
    await successor.reader.attach(harness.service)
    const library = await successor.reader.learningStorage()
    const beforeRetry = structuredClone({
      queued: readerSeams(successor).queuedStudyWrites(),
      listed: (await library.list()).map((entry) => [entry.id, entry.format]),
      errorLines: readerSeams(successor).errorLines(),
      history: harness.service.state(unsaved.record).historyOutcome.status,
    })
    unsaved.makeDiskWritable()
    // Act: the learner presses Retry storage / refresh in the new reader and chooses the study in Saved studies; an agent reads the run.
    await successor.reader.action('retry')
    const afterRetry = structuredClone({
      listed: (await library.list()).map((entry) => [
        entry.id,
        entry.format,
        entry.metadata,
      ]),
      errorLines: readerSeams(successor).errorLines(),
    })
    const run = await readResource(
      harness.service,
      harness.service.uri(unsaved.record.id),
    )
    await successor.reader.open()
    await readerSeams(successor).receive(
      {
        type: 'history',
        revision: successor.reader.inspect().view!.revision,
        studyId: unsaved.studyId,
      },
      'context',
    )
    await waitUntil(
      () =>
        successor.reader.inspect().view!.model.selection.studyId ===
          unsaved.studyId && !successor.reader.inspect().view!.loading,
      'the chosen saved study',
      1_000,
    )
    // Assert
    assert.equal(queuedInDisposedReader, 1)
    assert.deepEqual(beforeRetry, {
      queued: 0,
      listed: [[unsaved.studyId, 'archive-missing']],
      errorLines: [],
      history: 'failed',
    })
    assert.deepEqual(afterRetry, {
      listed: [[unsaved.studyId, 'v3', 'validated']],
      errorLines: [],
    })
    assert.ok('text' in run)
    assert.equal(JSON.parse(run.text).historyOutcome.status, 'saved')
    // The chosen study is shown: the captured source of the run's stop is rendered, without a line.
    assert.deepEqual(
      structuredClone(successor.reader.inspect().view!.errors),
      [],
    )
    assert.equal(
      successor.reader.inspect().rendered?.snapshotUri,
      `codebook://${harness.service.instanceId}/runs/${unsaved.record.id}/snapshots/browser-session%3A1`,
    )
  } finally {
    context.mock.restoreAll()
    await replacement?.dispose()
    await harness.close()
  }
})

// Value: protects=the study of a stopped run whose archive could not be saved before its server ended, when the workspace's folders then change: the reader made in place of the disposed one shows "History not saved: …" again, and one press on Retry storage / refresh saves the study, which opens; fails_when=the archive that waits is disposed with its reader, or the new reader does not take what was handed over, so the press writes nothing, the study stays without its archive for good and no line says so; why_new=Cycle 0046 row 278 (probe P2 of row 267, turned into this test); seam=the hand-over as the extension's handling of a changed workspace folder makes it (releaseUnsavedStudies, dispose, a new reader from the workspace harness's createReader with what was released) and the library's study save, which fails until the disk is writable again
for (const [situation, isWriteStillRunning, lineOfNewReader] of [
  [
    'whose save had failed',
    false,
    'Error: History not saved: Error: disk is read-only',
  ],
  [
    'whose write was still running',
    true,
    "Error: History not saved: a study of an earlier run was still being written when the workspace's folders changed. Press Retry storage / refresh to write it.",
  ],
] as const)
  test(`after the server of a stopped run ${situation} has ended and the workspace’s folders changed, the reader made again shows “History not saved: …” for it, writes its archive at Retry storage / refresh, and the study opens`, async (context) => {
    // Arrange: a stopped run whose archive could not be saved; its server stops while the disk still refuses, so the reader holds the archive of a run that no service holds any more.
    const harness = await workspaceHarness(true, true)
    let replacement: ReturnType<typeof harness.createReader> | undefined
    try {
      const unsaved = await stopRunOnRefusingDisk(context, harness)
      const retirement = await harness.reader.retire(harness.service).then(
        () => 'retired',
        (error: unknown) => String(error),
      )
      // A write that had not ended when the readers were replaced left no reason on the run.
      if (isWriteStillRunning)
        unsaved.record.historyReceipt = {
          revision: unsaved.record.historyReceipt!.revision,
          signature: unsaved.record.historyReceipt!.signature,
          status: 'pending',
        }
      // Act: the workspace's folders change: the extension takes what the reader could not save, disposes it and makes a new reader with it. The disk is writable again, and the learner presses Retry storage / refresh and chooses the study.
      const handedOver = harness.reader.releaseUnsavedStudies()
      await harness.reader.dispose()
      replacement = harness.createReader(undefined, handedOver)
      const successor = { reader: replacement },
        library = await successor.reader.learningStorage()
      const beforeRetry = structuredClone({
        queued: readerSeams(successor).queuedStudyWrites(),
        listed: (await library.list()).map((entry) => [entry.id, entry.format]),
        errors: successor.reader.inspect().view!.errors,
        unretryableErrorCount:
          successor.reader.inspect().view!.unretryableErrorCount,
      })
      unsaved.makeDiskWritable()
      await successor.reader.action('retry')
      const afterRetry = structuredClone({
        queued: readerSeams(successor).queuedStudyWrites(),
        listed: (await library.list()).map((entry) => [
          entry.id,
          entry.format,
          entry.metadata,
        ]),
        errors: successor.reader.inspect().view!.errors,
      })
      await successor.reader.open()
      await readerSeams(successor).receive(
        {
          type: 'history',
          revision: successor.reader.inspect().view!.revision,
          studyId: unsaved.studyId,
        },
        'context',
      )
      await waitUntil(
        () =>
          successor.reader.inspect().view!.model.selection.studyId ===
            unsaved.studyId && !successor.reader.inspect().view!.loading,
        'the chosen saved study',
        1_000,
        // A study that was not saved is never shown: the assertions below then say what the new reader held.
      ).catch(() => undefined)
      // Assert
      assert.equal(
        retirement,
        'Error: Runtime released; final reader history was not saved: Error: disk is read-only',
      )
      assert.deepEqual(
        structuredClone(handedOver.map((entry) => entry.archive.id)),
        [unsaved.studyId],
      )
      assert.deepEqual(beforeRetry, {
        queued: 1,
        listed: [[unsaved.studyId, 'archive-missing']],
        errors: [lineOfNewReader],
        // Retry storage / refresh is offered beside the line.
        unretryableErrorCount: 0,
      })
      assert.deepEqual(afterRetry, {
        queued: 0,
        listed: [[unsaved.studyId, 'v3', 'validated']],
        errors: [],
      })
      // The chosen study is shown: the captured source of the run's stop is rendered, without a line.
      assert.deepEqual(
        structuredClone(successor.reader.inspect().view!.errors),
        [],
      )
      assert.equal(
        successor.reader.inspect().rendered?.snapshotUri,
        `codebook://${harness.service.instanceId}/runs/${unsaved.record.id}/snapshots/browser-session%3A1`,
      )
    } finally {
      context.mock.restoreAll()
      await replacement?.dispose()
      await harness.close()
    }
  })

// Value: protects=a study archive of another workspace's library that reaches a reader in a hand-over: it is never written into this library, where it would be a study without its recording and take a place, it shows no line that Retry could not answer here, and it is not dropped: the next hand-over carries it on; fails_when=the new reader queues everything it is handed, so Retry tries to write a study of another workspace into this library, or the reader forgets what is not its own; why_new=Cycle 0046 row 278 (the reader takes those whose workspace key is its library's); seam=the hand-over (releaseUnsavedStudies and the workspace harness's createReader) with the archive's workspace key changed to another project's
test('a study archive of another workspace’s library that a disposed reader hands over is not written into this library and shows no line, and the reader hands it on again when it is replaced', async (context) => {
  // Arrange: a stopped run whose archive could not be saved and whose server ended; the archive that waits names another workspace's library.
  const harness = await workspaceHarness(true, true)
  let replacement: ReturnType<typeof harness.createReader> | undefined
  try {
    const unsaved = await stopRunOnRefusingDisk(context, harness)
    await harness.reader.retire(harness.service).catch(() => undefined)
    const otherWorkspaceKey = sha256('another project')
    const ofAnotherLibrary = harness.reader
      .releaseUnsavedStudies()
      .map((entry) => ({
        ...entry,
        archive: { ...entry.archive, workspaceKey: otherWorkspaceKey },
      }))
    await harness.reader.dispose()
    // Act: a new reader is made with it, the disk is writable, and the learner presses Retry storage / refresh; then that reader is replaced in turn.
    replacement = harness.createReader(undefined, ofAnotherLibrary)
    const successor = { reader: replacement },
      library = await successor.reader.learningStorage()
    unsaved.makeDiskWritable()
    await successor.reader.action('retry')
    const afterRetry = structuredClone({
      queued: readerSeams(successor).queuedStudyWrites(),
      listed: (await library.list()).map((entry) => [entry.id, entry.format]),
      errors: successor.reader.inspect().view!.errors,
    })
    const handedOn = successor.reader.releaseUnsavedStudies()
    // Assert
    assert.deepEqual(afterRetry, {
      queued: 0,
      // Only the run's recording, which was made in this library, is listed: no archive was written.
      listed: [[unsaved.studyId, 'archive-missing']],
      errors: [],
    })
    assert.deepEqual(
      structuredClone(
        handedOn.map((entry) => [entry.archive.id, entry.archive.workspaceKey]),
      ),
      [[unsaved.studyId, otherWorkspaceKey]],
    )
  } finally {
    context.mock.restoreAll()
    await replacement?.dispose()
    await harness.close()
  }
})

// Value: protects=the selected study of a run whose last save failed and whose archive on disk was then lost, when the workspace's folders change before Retry storage / refresh: the reader made in place of the disposed one holds the study's archive, so it keeps the study selected and shown, and the press writes the archive and leaves it selected; fails_when=that reader, which holds no run of the study, takes the entry without an archive for a study removed by hand although the archive waits in it: it opens on no study, and the press drops the selection while it writes the study back; why_new=Cycle 0046 row 357 (the local CodeRabbit CLI's third run); seam=the hand-over (releaseUnsavedStudies and the workspace harness's createReader), the library's study save, which refuses from a point the test chooses, and the file system, on which the test removes the archive
test('after the last save of the selected study failed, its archive on disk was lost and the workspace’s folders changed, the reader made again keeps the study selected with the archive it was handed, and Retry storage / refresh writes it and leaves it selected', async (context) => {
  // Arrange: a recorded run that was stopped and saved, whose study is the ledger's selection. From then on the disk refuses every study save, and a press on Retry storage / refresh leaves the study's archive waiting in the reader.
  const harness = await recordedReaderHarness()
  let replacement: ReturnType<typeof harness.createReader> | undefined
  try {
    const saveStudy = LearningLibrary.prototype.saveStudy
    let isDiskWritable = true
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        return isDiskWritable
          ? saveStudy.call(this, study)
          : Promise.reject(new Error('disk is read-only'))
      },
    )
    const studyId = harness.studyId,
      firstLibrary = await harness.reader.learningStorage()
    // The learner chooses the study in Saved studies, which writes the selection.
    await harness.reader.open()
    await readerSeams(harness).receive(
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId,
      },
      'context',
    )
    await waitUntil(
      async () =>
        (await firstLibrary.readProgress()).selection?.studyId === studyId,
      'the selection of the chosen study in the ledger',
      1_000,
    )
    const savedBeforeTheDiskRefused = structuredClone({
      listed: (await firstLibrary.list()).map((entry) => [
        entry.id,
        entry.format,
      ]),
      ledgerSelection: (await firstLibrary.readProgress()).selection?.studyId,
    })
    isDiskWritable = false
    await harness.reader.action('retry')
    await harness.reader.retire(harness.service).catch(() => undefined)
    // The archive on disk is lost (removed by hand); the study's catalog file is left.
    await rm(
      join(
        harness.reader.inspect().libraryDirectory!,
        `${studyId}.study.v3.json`,
      ),
    )
    // Act: the workspace's folders change: the extension takes what the reader could not save, disposes it and makes a new reader with it. Then the disk is writable again and the learner presses Retry storage / refresh.
    const handedOver = harness.reader.releaseUnsavedStudies()
    await harness.reader.dispose()
    replacement = harness.createReader(undefined, handedOver)
    const successor = { reader: replacement },
      library = await successor.reader.learningStorage()
    await successor.reader.open()
    const beforeRetry = structuredClone({
      queued: readerSeams(successor).queuedStudyWrites(),
      listed: (await library.list()).map((entry) => [entry.id, entry.format]),
      selected: successor.reader.inspect().view!.model.selection.studyId,
      shown: successor.reader.inspect().rendered?.snapshotUri,
      errors: successor.reader.inspect().view!.errors,
    })
    isDiskWritable = true
    await successor.reader.action('retry')
    const afterRetry = structuredClone({
      queued: readerSeams(successor).queuedStudyWrites(),
      listed: (await library.list()).map((entry) => [entry.id, entry.format]),
      selected: successor.reader.inspect().view!.model.selection.studyId,
      ledgerSelection: (await library.readProgress()).selection?.studyId,
      shown: successor.reader.inspect().rendered?.snapshotUri,
      errors: successor.reader.inspect().view!.errors,
    })
    // Assert
    const capturedSourceOfTheStop = `codebook://${harness.service.instanceId}/runs/${harness.record.id}/snapshots/browser-session%3A1`
    assert.deepEqual(savedBeforeTheDiskRefused, {
      listed: [[studyId, 'v3']],
      ledgerSelection: studyId,
    })
    assert.deepEqual(
      structuredClone(handedOver.map((entry) => entry.archive.id)),
      [studyId],
    )
    assert.deepEqual(beforeRetry, {
      queued: 1,
      listed: [[studyId, 'archive-missing']],
      selected: studyId,
      // The study is shown from the archive that waits: the captured source of the run's stop is rendered.
      shown: capturedSourceOfTheStop,
      errors: ['Error: History not saved: Error: disk is read-only'],
    })
    assert.deepEqual(afterRetry, {
      queued: 0,
      listed: [[studyId, 'v3']],
      selected: studyId,
      ledgerSelection: studyId,
      shown: capturedSourceOfTheStop,
      errors: [],
    })
  } finally {
    context.mock.restoreAll()
    await replacement?.dispose()
    await harness.close()
  }
})

// Value: protects=a removal by hand that took the archive of a study of this window's own stopped run: Retry storage / refresh does not write the archive again, so the learner can remove what is left; fails_when=the reader still takes the run's study for listed, and the forced checkpoint of Retry captures the run again and writes a new archive beside the rest; why_new=Cycle 0046 row 181 (read from the code by the library's fixer, not measured there); seam=the file system, on which the test removes the archive
test('after the archive of the study of this window’s own stopped run was removed by hand, Retry storage / refresh does not write that archive again and lists what is left', async () => {
  // Arrange: a recorded run of this window that was stopped and saved.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!,
      archive = join(directory, `${harness.studyId}.study.v3.json`)
    const filesBefore = (await readdir(directory))
      .filter((name) => name.includes('.study.'))
      .sort()
    // Act: the learner removes the archive alone and presses Retry storage / refresh, twice.
    await rm(archive)
    await harness.reader.action('retry')
    await harness.reader.action('retry')
    // Assert
    assert.deepEqual(filesBefore, [
      `${harness.studyId}.study.meta.v3.json`,
      `${harness.studyId}.study.v3.json`,
    ])
    assert.deepEqual(
      (await readdir(directory))
        .filter((name) => name.includes('.study.'))
        .sort(),
      [`${harness.studyId}.study.meta.v3.json`],
    )
    assert.deepEqual(
      (await library.list()).map((entry) => [entry.id, entry.format]),
      [[harness.studyId, 'archive-missing']],
    )
    assert.deepEqual(readerSeams(harness).errorLines(), [])
  } finally {
    await harness.close()
  }
})

/**
 * Removes every file of a recorded reader's saved study from its library, as the learner does by hand: the archive, the catalog file and the recording of the run.
 * @param harness - A recorded reader whose study was saved once.
 * @param studyId - The study whose files are removed; the harness's own study when left out.
 * @example await removeStudyFilesByHand(harness) // the library lists nothing of the study
 */
async function removeStudyFilesByHand(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
  studyId = harness.studyId,
): Promise<void> {
  const directory = harness.reader.inspect().libraryDirectory!
  await rm(join(directory, `${studyId}.study.v3.json`))
  await rm(join(directory, `${studyId}.study.meta.v3.json`))
  await rm(join(directory, 'recordings.v2', studyId), {
    recursive: true,
  })
}

// Value: protects=the pane of a study whose newest save failed and whose files the learner then removed by hand: the press on Retry storage / refresh forgets the study, writes nothing for it and leaves no line "History not saved: …"; fails_when=the forget of a study that left the library keeps its waiting archive or its failed receipt, so Retry writes the study back beside the removal, or the line stays for a study that is gone; why_new=Cycle 0048 task 126 (Step 7 gap): the tests of forgetRemovedStudy reach it through a move to the Trash and through a deletion with the recording, not through the study that Retry finds removed by hand; seam=the library's study save, which refuses every write while the test says so, and the file system, on which the test removes the study's files; no_claim=wording of the line
test('after the study of a failed save had its files removed by hand, Retry storage / refresh writes nothing for it and leaves no “History not saved: …” line', async (context) => {
  // Arrange: a recorded run of this window, saved once; the disk then refuses the next checkpoint, which leaves the line and a waiting archive. The learner removes every file of the study.
  const disk = refuseStudySaves(context)
  disk.refusesEveryStudy = false
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    disk.refusesEveryStudy = true
    await explainStoppedRunAndCheckpoint(harness, 'after-the-failure')
    const afterTheFailedSave = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
    })
    await removeStudyFilesByHand(harness)
    disk.refusesEveryStudy = false

    // Act: the learner presses Retry storage / refresh while the disk writes again.
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        afterTheFailedSave,
        afterRetry: {
          queued: readerSeams(harness).queuedStudyWrites(),
          errors: structuredClone(harness.reader.inspect().view!.errors),
          listed: (await (await harness.reader.learningStorage()).list()).map(
            (entry) => entry.id,
          ),
        },
      },
      {
        afterTheFailedSave: {
          queued: 1,
          errors: ['Error: History not saved: Error: disk is read-only'],
        },
        afterRetry: { queued: 0, errors: [], listed: [] },
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose newest save failed and whose files the learner removed by hand, when a later step of the same Retry storage / refresh fails: the learner reads the failure of that step and no line "History not saved: …" for the study that is gone; fails_when=only the Retry's last step retires the line, and a step that throws before it (here the library's reconcile) leaves the line and a Retry offer for a study that no longer waits, as the removal to the Trash and the deletion with the recording do not; why_new=Cycle 0048 task 126 (Step 7 gap): without a failing step after the forget, the Retry's own retirement hides a forget that keeps the line; seam=the library's study save, which refuses every write while the test says so, the library's reconcile, which fails while the test says so, and the file system, on which the test removes the study's files; no_claim=wording of the lines
test('after the study of a failed save had its files removed by hand, a Retry storage / refresh whose later step fails shows that failure and no “History not saved: …” line', async (context) => {
  // Arrange: as above, and the library's reconcile fails during the press.
  const disk = refuseStudySaves(context)
  disk.refusesEveryStudy = false
  let isReconcileFailing = false
  const reconcile = LearningLibrary.prototype.reconcile
  context.mock.method(
    LearningLibrary.prototype,
    'reconcile',
    function (this: LearningLibrary) {
      return isReconcileFailing
        ? Promise.reject(new Error('reconcile is unavailable'))
        : reconcile.call(this)
    },
  )
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    disk.refusesEveryStudy = true
    await explainStoppedRunAndCheckpoint(harness, 'after-the-failure')
    await removeStudyFilesByHand(harness)
    isReconcileFailing = true

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        queued: readerSeams(harness).queuedStudyWrites(),
        errors: structuredClone(harness.reader.inspect().view!.errors),
      },
      { queued: 0, errors: ['Error: reconcile is unavailable'] },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=an agent that reads a run of this window after the learner removed the study's files by hand: the run and its evidence answer with what Codebook found; fails_when=the reader forgets such a run as "removed by the learner", so the run resource and every evidence read say "The learner moved this saved study to the Trash.", which names a Trash the study never went to and a window without a Trash does not have; why_new=Cycle 0046 row 201; seam=the file system, on which the test removes the archive, and the resources an agent reads
test('after the archive of the study of this window’s own stopped run was removed by hand and Retry storage / refresh was pressed, an agent that reads the run or its evidence is told that the archive is no longer in the library, not that the study went to the Trash', async () => {
  // Arrange: a recorded run of this window that was stopped and saved.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.learningStorage()
    const service = harness.service,
      runUri = service.uri(harness.record.id),
      eventsUri = service.uri(harness.record.id, 'events/0')
    const eventsBefore = await readResource(service, eventsUri)
    // Act: the learner removes the archive and presses Retry storage / refresh; the agent reads the run and its events.
    await rm(
      join(
        harness.reader.inspect().libraryDirectory!,
        `${harness.studyId}.study.v3.json`,
      ),
    )
    await harness.reader.action('retry')
    const run = await readResource(service, runUri)
    const eventsAfter = await readResource(service, eventsUri).then(
      () => 'answered',
      (error: unknown) =>
        error instanceof StudyError ? [error.code, error.message] : error,
    )
    // Assert
    assert.ok('text' in eventsBefore)
    assert.ok('text' in run)
    const { status, reason } = JSON.parse(run.text).historyOutcome
    assert.deepEqual(
      [status, reason],
      [
        'unavailable',
        "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
      ],
    )
    assert.deepEqual(eventsAfter, [
      'EVIDENCE_UNAVAILABLE',
      "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
    ])
  } finally {
    await harness.close()
  }
})

/**
 * Writes one saved study an older Codebook left into the reader's library: an archive in a historical format, which the library lists without reading it and Retry writes nothing for.
 * @param directory - The reader's library directory.
 * @returns The study's id and its archive's path.
 * @example const older = await writeHistoricalStudy(directory) // listed after the next Retry storage / refresh
 */
async function writeHistoricalStudy(
  directory: string,
): Promise<{ id: string; archive: string }> {
  const id = `${randomUUID()}_${randomUUID()}`,
    archive = join(directory, `${id}.study.v2.json`)
  await writeFile(archive, '{}')
  return { id, archive }
}

// Value: protects=two panes of a window without a Trash that ask for the files of their studies at the same moment (each open "Remove by hand" asks again after Retry storage / refresh) both getting their answer; fails_when=the reader drops the request that arrives while the other is being answered, so the pane that sent it waits for an answer that never comes and stays at "Listing this study's files…" with no button; why_new=Cycle 0046 row 168 (delegated review, finding 4c); seam=two delete requests received in one tick, as the Study pane and the bottom-panel view send them
test('in a window without a Trash two panes that ask for the files of two studies at the same moment are both answered, each with the number it gave its request', async () => {
  // Arrange: a WSL remote window with two saved studies an older Codebook left, and the Study workspace open.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    await harness.reader.learningStorage()
    const directory = harness.reader.inspect().libraryDirectory!
    const first = await writeHistoricalStudy(directory),
      second = await writeHistoricalStudy(directory)
    await harness.reader.action('retry')
    await harness.reader.open()
    const revision = harness.reader.inspect().view!.revision,
      publishedBefore = harness.postedMessages().length
    /** Sends one pane's request for a study's files under the shown revision. */
    const ask = (
      pane: 'context' | 'moments',
      studyId: string,
      removalRequest: number,
    ): Promise<void> =>
      readerSeams(harness).receive(
        { type: 'delete-study', revision, studyId, removalRequest },
        pane,
      )
    // Act: both panes ask before either request is answered.
    await Promise.all([
      ask('context', first.id, 1),
      ask('moments', second.id, 2),
    ])
    // Assert: every answer the Study pane received, in order, and the lists the reader keeps for both.
    const answers = harness
      .postedMessages()
      .slice(publishedBefore)
      .flatMap((message) =>
        message.studyRemoval
          ? [
              {
                request: message.studyRemoval.request,
                files: message.studyRemoval.files,
                revision: message.revision,
              },
            ]
          : [],
      )
    assert.deepEqual(structuredClone(answers), [
      { request: 1, files: [first.archive], revision },
      { request: 2, files: [second.archive], revision },
    ])
    assert.deepEqual(
      structuredClone(harness.reader.inspect().view!.studyFiles),
      { [first.id]: [first.archive], [second.id]: [second.archive] },
    )
    assert.deepEqual(readerSeams(harness).errorLines(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner of a window without a Trash seeing no error line for a request the pane sent by itself: an open "Remove by hand" asks for its study's files again after Retry storage / refresh, and such a request can reach the reader after it rendered again; fails_when=the reader refuses it like a control the learner pressed on a view that has changed, and the pane shows "Error: The displayed study changed. Inspect the current view before acting." for nothing the learner did; why_new=Cycle 0046 row 202; seam=the Study pane's webview, through which the message and its refusal travel as in the editor
test('in a window without a Trash a request for a study’s files that the pane sent by itself is answered although the reader has rendered since, without an error line, and the same request made by the learner on the old view keeps its sentence', async () => {
  // Arrange: a WSL remote window with a saved study an older Codebook left; the Study workspace is open and has rendered again since the pane read its revision.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    await harness.reader.learningStorage()
    const study = await writeHistoricalStudy(
      harness.reader.inspect().libraryDirectory!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const revisionThePaneRead = harness.reader.inspect().view!.revision
    await harness.reader.action('retry')
    const revisionNow = harness.reader.inspect().view!.revision
    /** Sends the pane's request under the revision it read, and waits until the reader has answered it or told a line. */
    const askUnderOldRevision = async (
      removalRequest: number,
      mark: { unprompted?: true },
    ) => {
      harness.receive({
        type: 'delete-study',
        revision: revisionThePaneRead,
        studyId: study.id,
        removalRequest,
        ...mark,
      })
      await waitUntil(
        () =>
          harness.reader.inspect().view!.studyRemoval?.request ===
            removalRequest || readerSeams(harness).errorLines().length > 0,
        'the answer to the files request or a line',
        2_000,
      )
      return structuredClone({
        answeredRequest: harness.reader.inspect().view!.studyRemoval?.request,
        files: harness.reader.inspect().view!.studyFiles?.[study.id],
        errorLines: readerSeams(harness).errorLines(),
      })
    }
    // Act: the pane's own request, then the same request as the learner makes it by opening the disclosure.
    const sentByThePane = await askUnderOldRevision(1, { unprompted: true })
    const madeByTheLearner = await askUnderOldRevision(2, {})
    // Assert
    assert.equal(revisionNow, revisionThePaneRead + 1)
    assert.deepEqual(sentByThePane, {
      answeredRequest: 1,
      files: [study.archive],
      errorLines: [],
    })
    assert.deepEqual(madeByTheLearner, {
      answeredRequest: 1,
      files: [study.archive],
      errorLines: [
        'Error: The displayed study changed. Inspect the current view before acting.',
      ],
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=an open "Remove by hand" in a window without a Trash getting its files while a presentation changes, without an error line, and the change itself ending as it would have; fails_when=the reader refuses the pane's own request like a control pressed during the change, so the pane shows "Error: A presentation change or reader close is pending. …" for nothing the learner did and stays at "Listing this study's files…" until another message makes it ask again; or the answer disturbs the change; why_new=Cycle 0046 row 219 (row 202's branch stood ahead of that check untested); seam=a presentation change the harness holds half-way, and the Study pane's webview
test('in a window without a Trash a request for a study’s files that the pane sent by itself is answered while a presentation changes, without an error line and without touching the change, and the same request made by the learner then keeps its sentence', async () => {
  // Arrange: a WSL remote window with a saved study an older Codebook left; the Study workspace is open and a presentation change is held half-way.
  const harness = await workspaceHarness(false, false, 'wsl')
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.learningStorage()
    const study = await writeHistoricalStudy(
      harness.reader.inspect().libraryDirectory!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const held = harness.holdPresentationMessage()
    release = held.release
    const before = harness.reader.presentationState()
    const change = harness.reader.changePresentation({
      presentationId: before.presentationId,
      expectedRevision: before.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    await held.started
    /** Sends the pane's request during the change and waits until the reader has answered it or told a line. */
    const askDuringTheChange = async (
      removalRequest: number,
      mark: { unprompted?: true },
    ) => {
      harness.receive({
        type: 'delete-study',
        revision: harness.reader.inspect().view!.revision,
        studyId: study.id,
        removalRequest,
        ...mark,
      })
      await waitUntil(
        () =>
          harness.reader.inspect().view!.studyRemoval?.request ===
            removalRequest || readerSeams(harness).errorLines().length > 0,
        'the answer to the files request or a line',
        2_000,
      )
      return structuredClone({
        answeredRequest: harness.reader.inspect().view!.studyRemoval?.request,
        files: harness.reader.inspect().view!.studyFiles?.[study.id],
        errorLines: readerSeams(harness).errorLines(),
        presentation: harness.reader.presentationState().state,
      })
    }
    // Act: the pane's own request, then the same request as the learner makes it; then the change is let go.
    const sentByThePane = await askDuringTheChange(1, { unprompted: true })
    const madeByTheLearner = await askDuringTheChange(2, {})
    held.release()
    const changed = await change
    // Assert
    assert.deepEqual(sentByThePane, {
      answeredRequest: 1,
      files: [study.archive],
      errorLines: [],
      presentation: 'applying',
    })
    assert.deepEqual(madeByTheLearner, {
      answeredRequest: 1,
      files: [study.archive],
      errorLines: [
        'Error: A presentation change or reader close is pending. Read its state before another control.',
      ],
      presentation: 'applying',
    })
    assert.deepEqual([changed.mode, changed.state], ['living-book', 'open'])
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a saved study in a window with a Trash: no message can start its removal past the reader's checks by calling itself a request of the pane; fails_when=the reader answers every delete request marked `unprompted` whatever it shows, so a marked message under an old revision opens the removal dialog for a study the learner may no longer see; why_new=Cycle 0046 row 202 (the mark is honoured in a window without a Trash only); seam=the Study pane's webview and the editor's dialog, recorded by the harness
test('in a window with a Trash a delete request marked as sent by the pane keeps every check: under an old revision it is refused with its sentence, and no dialog opens', async () => {
  // Arrange: a window with a Trash, one saved study, and a Study workspace that has rendered again since the pane read its revision.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    const revisionThePaneRead = harness.reader.inspect().view!.revision
    await harness.reader.action('retry')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    harness.receive({
      type: 'delete-study',
      revision: revisionThePaneRead,
      studyId: study.id,
      removalRequest: 1,
      unprompted: true,
    })
    await waitUntil(
      () =>
        readerSeams(harness).errorLines().length > 0 ||
        harness.warningDialogs.length > 0,
      'the refusal of the marked request or a dialog',
      2_000,
    )
    // Assert
    assert.deepEqual(readerSeams(harness).errorLines(), [
      'Error: The displayed study changed. Inspect the current view before acting.',
    ])
    assert.equal(harness.warningDialogs.length, 0)
    assert.deepEqual(harness.trashMoves, [])
    assert.equal(harness.reader.inspect().view!.studyRemoval, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner of a window without a Trash who opens "Remove by hand" for a study whose files cannot be listed: the disclosure says so with its reason and offers Retry storage / refresh; fails_when=the listing's failure is thrown, becomes a control line, and no answer with the request's number is published, so the pane stays at "Listing this study's files…" with no button and asks nothing again; why_new=Cycle 0046 row 251; seam=the library's listing of a study's files, which rejects once, and the Study pane's webview
test('in a window without a Trash a request for a study’s files whose listing fails is answered with a refusal that carries the request’s number and the reason, without an error line, and the next request lists the files', async (context) => {
  // Arrange: a WSL remote window with a saved study an older Codebook left; the listing of a study's files rejects once.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    await harness.reader.learningStorage()
    const study = await writeHistoricalStudy(
      harness.reader.inspect().libraryDirectory!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const studyFiles = LearningLibrary.prototype.studyFiles
    let isListingRefused = true
    context.mock.method(
      LearningLibrary.prototype,
      'studyFiles',
      function (
        this: LearningLibrary,
        ...listed: Parameters<LearningLibrary['studyFiles']>
      ) {
        if (!isListingRefused) return studyFiles.apply(this, listed)
        isListingRefused = false
        return Promise.reject(
          new Error(
            "EACCES: permission denied, lstat '/library/recordings.v2'",
          ),
        )
      },
    )
    /** Sends the pane's request and waits until the reader has answered it or told a line. */
    const ask = async (removalRequest: number) => {
      harness.receive({
        type: 'delete-study',
        revision: harness.reader.inspect().view!.revision,
        studyId: study.id,
        removalRequest,
      })
      await waitUntil(
        () =>
          harness.reader.inspect().view!.studyRemoval?.request ===
            removalRequest || readerSeams(harness).errorLines().length > 0,
        'the answer to the files request or a line',
        2_000,
      )
      return structuredClone({
        answer: harness.reader.inspect().view!.studyRemoval,
        errorLines: readerSeams(harness).errorLines(),
      })
    }
    // Act: the request whose listing fails, and the next one.
    const whileListingFails = await ask(1)
    const afterwards = await ask(2)
    // Assert
    assert.deepEqual(whileListingFails, {
      answer: {
        status: 'refused',
        studyId: study.id,
        text: "Codebook could not list this study's files. Press Retry storage / refresh to try again. EACCES: permission denied, lstat '/library/recordings.v2'",
        request: 1,
      },
      errorLines: [],
    })
    assert.deepEqual(afterwards, {
      answer: {
        status: 'refused',
        studyId: study.id,
        text: 'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.',
        files: [study.archive],
        request: 2,
      },
      errorLines: [],
    })
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=what the Study pane's DOM check takes for granted about the reader in a window without a Trash: an answer to a request for a study's files, a refusal as well, and the message that ends Retry storage / refresh while the Study workspace is closed all carry the revision the pane asked under; fails_when=the reader gives such a message a new revision, so the DOM cases of "Remove by hand", which publish them under the asking revision, no longer show what a learner gets (they passed on a fixture that gave every message a new revision, while the pane stayed at "Listing this study's files…" in the product); why_new=Cycle 0046 row 168 (delegated review, findings 4 and 5); seam=the bottom-panel view's requests with the Study workspace closed
test('in a window without a Trash the reader answers a request for a study’s files, a refusal as well, and ends Retry storage / refresh with the Study workspace closed, all under the revision the request was sent with', async () => {
  // Arrange: a WSL remote window with a saved study an older Codebook left and a saved Node test history; the Study workspace is not open.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    await harness.reader.learningStorage()
    const study = await writeHistoricalStudy(
      harness.reader.inspect().libraryDirectory!,
    )
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const view = () => harness.reader.inspect().view!
    const revisionAsked = view().revision
    /** Sends the bottom panel's request for a study's files and reads what the reader answers. */
    const answerTo = async (studyId: string, removalRequest: number) => {
      await readerSeams(harness).receive(
        {
          type: 'delete-study',
          revision: revisionAsked,
          studyId,
          removalRequest,
        },
        'moments',
      )
      return structuredClone({
        revision: view().revision,
        answer: view().studyRemoval,
      })
    }
    // Act: a request the reader refuses, one it lists files for, and Retry storage / refresh.
    const refused = await answerTo(nodeHistory.studyId, 1)
    const listed = await answerTo(study.id, 2)
    await harness.reader.action('retry')
    const afterRetry = structuredClone({
      revision: view().revision,
      answer: view().studyRemoval,
      studyFiles: view().studyFiles,
    })
    // Assert
    assert.deepEqual(refused, {
      revision: revisionAsked,
      answer: {
        status: 'refused',
        studyId: nodeHistory.studyId,
        text: 'Codebook cannot list the files of a Node test history for removal by hand yet.',
        request: 1,
      },
    })
    assert.deepEqual(listed, {
      revision: revisionAsked,
      answer: {
        status: 'refused',
        studyId: study.id,
        text: 'This window has no Trash, so Codebook cannot delete a saved study here. Remove these files by hand, then press Retry storage / refresh.',
        files: [study.archive],
        request: 2,
      },
    })
    assert.deepEqual(afterRetry, {
      revision: revisionAsked,
      answer: undefined,
      studyFiles: {},
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner can copy the files of a study a window without a Trash listed, to remove them in a terminal; fails_when=the copy request copies nothing, or text the pane sent instead of the reader's own list (RT-7, DR-14); why_new=the reader had no list to copy; seam=the editor's clipboard, recorded by the harness
test('in a window without a Trash, copying the listed files of a study puts the reader’s own list on the clipboard, one path a line', async () => {
  // Arrange: a WSL remote window with one saved study whose files a delete request has listed.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    await requestRemoval(harness, study.id)
    const directory = harness.reader.inspect().libraryDirectory!
    // Act
    await readerSeams(harness).receive(
      {
        type: 'copy-study-files',
        revision: harness.reader.inspect().view!.revision,
        studyId: study.id,
      },
      'context',
    )
    // Assert
    assert.deepEqual(harness.clipboardTexts, [
      `${join(directory, `${study.id}.study.meta.v3.json`)}\n${join(directory, `${study.id}.study.v3.json`)}`,
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=two panes of a window without a Trash each listing the files of the entry it has chosen: the list one pane asked for stays when another pane asks for another study, and Copy path copies the list of the study it names; fails_when=the reader keeps one answer for all panes, so the second pane's request takes the first study's list away, the first pane asks again at the next Study message, and Copy path of the first study copies nothing; why_new=Cycle 0045 local review study-1 #4 (the lists travelled in the one removal state); seam=two delete requests as the Study pane and the bottom-panel view send them, the reader's Study message and the editor's clipboard, recorded by the harness
test('in a window without a Trash, the files listed for one study stay listed and can be copied after another pane asked for another study', async () => {
  // Arrange: a WSL remote window with two saved studies; the Study pane asked for the files of the first.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await harness.reader.open()
    const directory = harness.reader.inspect().libraryDirectory!
    await requestRemoval(harness, first.id, 1)

    // Act: the bottom-panel view asks for the files of the second study, and the Study pane copies the first study's list.
    await readerSeams(harness).receive(
      {
        type: 'delete-study',
        revision: harness.reader.inspect().view!.revision,
        studyId: second.id,
        removalRequest: 2,
      },
      'moments',
    )
    await readerSeams(harness).receive(
      {
        type: 'copy-study-files',
        revision: harness.reader.inspect().view!.revision,
        studyId: first.id,
      },
      'context',
    )

    // Assert
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.studyFiles), {
      [first.id]: [
        join(directory, `${first.id}.study.meta.v3.json`),
        join(directory, `${first.id}.study.v3.json`),
      ],
      [second.id]: [
        join(directory, `${second.id}.study.meta.v3.json`),
        join(directory, `${second.id}.study.v3.json`),
      ],
    })
    assert.equal(view.studyRemoval?.studyId, second.id)
    assert.deepEqual(harness.clipboardTexts, [
      `${join(directory, `${first.id}.study.meta.v3.json`)}\n${join(directory, `${first.id}.study.v3.json`)}`,
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who pressed Copy paths is told that the paths are on the clipboard, by the host that wrote them; fails_when=the reader copies and answers nothing, so the pane has no sign that the copy worked (or confirms it without knowing), or the answer goes to another pane; why_new=Cycle 0046 row 27, DR-6 (the copy only wrote the clipboard); seam=the Study pane's webview and the editor's clipboard, recorded by the harness
test('in a window without a Trash, Copy paths writes the listed files one path a line and then answers the asking pane with their number', async () => {
  // Arrange: a WSL remote window with one saved study whose files a request has listed.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    await requestRemoval(harness, study.id)
    const directory = harness.reader.inspect().libraryDirectory!
    // Act: the Study pane's webview sends the copy request.
    harness.receive({
      type: 'copy-study-files',
      revision: harness.reader.inspect().view!.revision,
      studyId: study.id,
    })
    await waitUntil(
      () => harness.studyFilesCopyAnswers().length > 0,
      'the answer to Copy paths',
      2_000,
    )
    // Assert
    assert.deepEqual(harness.clipboardTexts, [
      `${join(directory, `${study.id}.study.meta.v3.json`)}\n${join(directory, `${study.id}.study.v3.json`)}`,
    ])
    assert.deepEqual(harness.studyFilesCopyAnswers(), [
      {
        webview: 'context',
        answer: {
          type: 'study-files-copied',
          studyId: study.id,
          status: 'copied',
          count: 2,
        },
      },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner is not told "Copied" when the clipboard took nothing; fails_when=the reader answers before the write settled or swallows its rejection, so the pane confirms a copy that did not happen; why_new=Cycle 0046 row 27, DR-6; seam=the editor's clipboard, which refuses every write
test('in a window without a Trash, Copy paths answers the asking pane with a failure when the clipboard refuses the write', async () => {
  // Arrange: a WSL remote window with one saved study whose files are listed, and a clipboard that refuses.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    await requestRemoval(harness, study.id)
    harness.rejectClipboardWrites()
    // Act
    harness.receive({
      type: 'copy-study-files',
      revision: harness.reader.inspect().view!.revision,
      studyId: study.id,
    })
    await waitUntil(
      () => harness.studyFilesCopyAnswers().length > 0,
      'the answer to Copy paths',
      2_000,
    )
    // Assert
    assert.deepEqual(harness.clipboardTexts, [])
    assert.deepEqual(harness.studyFilesCopyAnswers(), [
      {
        webview: 'context',
        answer: {
          type: 'study-files-copied',
          studyId: study.id,
          status: 'failed',
        },
      },
    ])
    assert.deepEqual(readerSeams(harness).errorLines(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a copy request for a study whose files the reader never listed copies nothing and says so; fails_when=the reader writes an empty clipboard or text the pane named, or leaves the pane without an answer; why_new=Cycle 0046 row 27, DR-6; seam=the Study pane's webview and the editor's clipboard, recorded by the harness
test('in a window without a Trash, Copy paths for a study whose files were never listed writes nothing and answers the asking pane with a failure', async () => {
  // Arrange: a WSL remote window with one saved study; no request listed its files.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    // Act
    harness.receive({
      type: 'copy-study-files',
      revision: harness.reader.inspect().view!.revision,
      studyId: study.id,
    })
    await waitUntil(
      () => harness.studyFilesCopyAnswers().length > 0,
      'the answer to Copy paths',
      2_000,
    )
    // Assert
    assert.deepEqual(harness.clipboardTexts, [])
    assert.deepEqual(harness.studyFilesCopyAnswers(), [
      {
        webview: 'context',
        answer: {
          type: 'study-files-copied',
          studyId: study.id,
          status: 'failed',
        },
      },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=in a window without a Trash the sentence the reader refuses a files request with says what the learner can do there; fails_when=the refusal speaks of deleting, which that window cannot do, and "Remove by hand" shows that sentence; why_new=Cycle 0046 row 59 (ND-1: the reasons were worded for a window with a Trash only); seam=the editor's remote name
test('in a window without a Trash, a request for the files of a Node test history or of the study of a run that has not stopped is refused with a sentence about removing by hand, not about deleting', async () => {
  // Arrange: a WSL remote window with a saved Node test history and a live run whose study the reader has saved.
  const harness = await workspaceHarness(true, false, 'wsl')
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const { record } = await startRun(harness)
    const liveStudyId = `${harness.service.instanceId}_${record.id}`
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === liveStudyId),
      'the saved study of the live run',
      2_000,
    )
    // Act
    await requestRemoval(harness, nodeHistory.studyId)
    const node = structuredClone(harness.reader.inspect().view!.studyRemoval)
    await requestRemoval(harness, liveStudyId)
    const live = structuredClone(harness.reader.inspect().view!.studyRemoval)
    // Assert
    assert.deepEqual(node, {
      status: 'refused',
      studyId: nodeHistory.studyId,
      text: 'Codebook cannot list the files of a Node test history for removal by hand yet.',
    })
    assert.deepEqual(live, {
      status: 'refused',
      studyId: liveStudyId,
      text: "Stop the run before removing its study's files by hand.",
    })
    assert.equal(harness.reader.inspect().view!.removalWithoutTrash, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader's own study library and recording store word a full-library refusal with the remedy that works in this editor; fails_when=the reader builds them without the session's removal availability, so their refusals keep naming a deletion after the Trash refused one (B-M3, C-L3); why_new=only the run refusal was tested after a refused removal; seam=the editor's Trash, stubbed at the vscode boundary, which refuses every move
test('after the Trash refused a removal, a save and a recording refused by the reader’s full library name only the limit setting', async () => {
  // Arrange: a library full at one study whose removal the Trash refuses, and a recording library full at one recording.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    harness.rejectTrashMoves(() => true)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, earlier.id)
    const library = await harness.reader.learningStorage(),
      store = harness.service.recordings!
    const bindingOf = (runId: string) => ({
      workspaceKey: library.workspaceKey,
      studyId: `${earlier.instanceId}_${runId}`,
      instanceId: earlier.instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: earlier.profile,
      sourceBuild: {
        revision: 'earlier-run',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    })
    await (await store.start(bindingOf(earlier.runId), 0)).finish(1)
    const laterRunId = randomUUID(),
      later = structuredClone(earlier)
    for (const observation of later.observations)
      observation.snapshotUri = observation.snapshotUri.replace(
        later.runId,
        laterRunId,
      )
    later.runId = laterRunId
    later.id = `${later.instanceId}_${laterRunId}`
    // Act
    const save = library.saveStudy(later),
      reservation = store.start(bindingOf(laterRunId), 0)
    // Assert
    await assert.rejects(save, {
      message: `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, then retry storage; this editor could not move a saved study to the ${TRASH} in this session. Existing learning was kept.`,
    })
    await assert.rejects(reservation, {
      message: `Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another session; this editor could not move a saved study to the ${TRASH} in this session. Existing recordings were kept.`,
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=the outcome of a removal and the delete button do not wait for neighbours that are slow or cannot be read; fails_when=the removal stays `moving` until the study that follows has been read (0038-F19e); why_new=the neighbour read was only held to test what is shown afterwards; seam=the library's archive read, held by the test
test('a removal reports what it moved while the study that follows is still being read', async (context) => {
  // Arrange: two studies; the newer one is shown and removed, and the read of its neighbour is held.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    // Act
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    const whileNeighbourIsRead = structuredClone(
      harness.reader.inspect().view!.studyRemoval,
    )
    neighbourRead.release()
    await removal
    // Assert
    assert.deepEqual(whileNeighbourIsRead, {
      status: 'moved',
      studyId: removed.id,
      text: `Saved study moved to the ${TRASH}. The library now holds 1 of 64 saved studies.`,
    })
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      neighbour.id,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a neighbour the list shows as validated but whose archive can no longer be read is passed over for the next one; fails_when=the failed read ends the search or selects the unreadable neighbour (0038-T8); why_new=only entries the catalog already marks unavailable were skipped in a test; seam=the library's archive read, which rejects for the nearest neighbour
test('after the shown study is removed, a listed neighbour whose archive read fails is passed over and the next saved study is shown', async (context) => {
  // Arrange: three studies, the newest shown; reading the middle one, its nearest neighbour, fails.
  const harness = await workspaceHarness()
  try {
    const oldest = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      unreadable = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      shown = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, shown.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === unreadable.id) throw new Error('EIO: i/o error, read')
        return readCheckpoint.call(this, id)
      },
    )
    // Act
    await requestRemoval(harness, shown.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.studyRemoval?.status, 'moved')
    assert.equal(view.model.selection.studyId, oldest.id)
    assert.equal(view.study?.id, oldest.id)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=choosing an item, which is no choice of a saved study, does not cost the learner the study that follows a removed one; fails_when=every action that takes a history request number counts as a choice, so the removal ends on no study (0040-D2); why_new=only saved studies and Node test histories were chosen during a removal; seam=the library's archive read, held by the test
test('an item selected while the neighbour of a removed study is being read leaves the neighbour shown', async (context) => {
  // Arrange: two studies; the newer one is shown and removed, and the read of its neighbour is held.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    // Act
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    await harness.reader.select('repository/interface/theme')
    neighbourRead.release()
    await removal
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, neighbour.id)
    assert.equal(view.study?.id, neighbour.id)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the list a removal leaves behind is the one the library holds, also when nothing moved; fails_when=a removal that moved nothing keeps a list that changed meanwhile (0038-F19b); why_new=nothing-moved was only tested with an unchanged library; seam=the editor's Trash, stubbed at the vscode boundary, before whose refused move another archive appears in the library
test('a removal that moved nothing shows a saved study that appeared in the library meanwhile', async () => {
  // Arrange: one study whose removal the Trash refuses; another archive appears in the library while the removal runs.
  const harness = await workspaceHarness()
  try {
    const kept = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const appearedStudyId = `${randomUUID()}_${randomUUID()}`
    harness.beforeTrashMoves(() =>
      writeFile(
        join(
          harness.reader.inspect().libraryDirectory!,
          `${appearedStudyId}.study.json`,
        ),
        'not json',
      ),
    )
    harness.rejectTrashMoves(() => true)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, kept.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.studyRemoval?.status, 'failed')
    assert.deepEqual(
      structuredClone(view.studies.map((entry) => entry.id).sort()),
      [appearedStudyId, kept.id].sort(),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a delete request sent from a view the reader has since replaced deletes nothing; fails_when=the stale-revision guard does not cover `delete-study` (0038-T1); why_new=no delete request carried an old revision; seam=none
test('a delete request that carries the revision of an earlier view is rejected with the stale-view sentence, asks nothing and moves nothing', async () => {
  // Arrange: the pane's revision is taken, then the reader shows another study.
  const harness = await workspaceHarness()
  try {
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, first.id)
    const earlierRevision = harness.reader.inspect().view!.revision
    await chooseStudy(harness, second.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    const request = readerSeams(harness).receive(
      { type: 'delete-study', revision: earlierRevision, studyId: first.id },
      'context',
    )
    // Assert
    await assert.rejects(request, {
      message:
        'The displayed study changed. Inspect the current view before acting.',
    })
    assert.equal(harness.warningDialogs.length, 0)
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=only a study identity reaches the removal from the pane; fails_when=a path-like id in a `delete-study` message reaches the confirmation or the mover (0038-T5); why_new=no negative identity test existed for the message; seam=none
test('a delete request whose id is not a study identity is rejected as an unsupported message and moves nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    const request = readerSeams(harness).receive(
      {
        type: 'delete-study',
        revision: harness.reader.inspect().view!.revision,
        studyId: '../x',
      },
      'context',
    )
    // Assert
    await assert.rejects(request, { message: 'Unsupported reader message.' })
    assert.equal(harness.warningDialogs.length, 0)
    assert.deepEqual(harness.trashMoves, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that moved every file keeps its `moved` outcome when the reads that follow it fail; fails_when=a failed room read or list read after the move turns the outcome into a failure or drops the line (0038-T2, 0038-T10); why_new=the reads after a completed move were only tested when they succeed; seam=the library's usage and list reads, which reject after the move
test('a removal whose room read and list read fail after every file moved still reports the study as moved, without a count', async (context) => {
  // Arrange: after the archive moved, the library can be neither listed nor counted.
  const harness = await workspaceHarness()
  try {
    const kept = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.beforeTrashMoves(async (path) => {
      if (!path.endsWith('.study.v3.json')) return
      context.mock.method(LearningLibrary.prototype, 'usage', async () => {
        throw new Error('EACCES: permission denied, scandir')
      })
      context.mock.method(LearningLibrary.prototype, 'list', async () => {
        throw new Error('EACCES: permission denied, scandir')
      })
    })
    // Act
    await requestRemoval(harness, removed.id)
    context.mock.restoreAll()
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.studyRemoval?.status, 'moved')
    assert.equal(view.studyRemoval?.studyId, removed.id)
    assert.equal(view.studyRemoval?.text, `Saved study moved to the ${TRASH}.`)
    assert.equal(
      view.errors.some((line) =>
        line.includes('EACCES: permission denied, scandir'),
      ),
      true,
    )
    // Only the removed study's files went to the Trash; the other study was not touched.
    assert.deepEqual(
      harness.trashMoves.map((move) => basename(move.path)),
      [`${removed.id}.study.meta.v3.json`, `${removed.id}.study.v3.json`],
    )
    assert.deepEqual(
      (await studyFiles(harness)).map(([name]) => name),
      [`${kept.id}.study.meta.v3.json`, `${kept.id}.study.v3.json`],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=right after its study was removed, a run offers no Save learning replay and refuses one; fails_when=the Save item stays visible or a Save is accepted until the reader is retired (0038-T7); why_new=both were asserted only after retirement, which passes without the guards; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('right after the study of this window’s stopped run was removed, the Save learning replay item is hidden and a Save is refused', async () => {
  // Arrange: a recorded run of this window that was stopped and saved.
  const harness = await recordedReaderHarness()
  try {
    assert.equal(harness.saveStatus.visible, true)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    // Act
    await requestRemoval(harness, harness.studyId)
    // Assert: no refresh, no Retry storage and no retirement has run.
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.equal(harness.saveStatus.visible, false)
    await assert.rejects(harness.reader.saveLearningReplay(), {
      message:
        'No recorded Codebook session is available. Explain a real code path first.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=after a removal that moved no file but could not write the ledger back, the reader shows what the ledger on disk says; fails_when=the reader keeps the ledger it read before the removal (0040-D9); why_new=the failed write-back was only asserted for the outcome line; seam=the editor's Trash, stubbed at the vscode boundary, before whose refused move the ledger path is blocked
test('after a removal that moved nothing and could not write the ledger back, the reader reads the ledger again and reports that it cannot be read', async () => {
  // Arrange: as the failed write-back: the ledger names the study, the first move is refused after the ledger path was blocked.
  const harness = await recordedReaderHarness()
  try {
    const directory = harness.reader.inspect().libraryDirectory!
    await chooseStudy(harness, harness.studyId)
    await rm(join(directory, 'recordings.v2', harness.studyId), {
      recursive: true,
    })
    const ledgerPath = join(directory, 'progress.repository.v4.json')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.beforeTrashMoves(async () => {
      await rm(ledgerPath, { recursive: true })
      await mkdir(join(ledgerPath, 'blocked'), { recursive: true })
    })
    harness.rejectTrashMoves(() => true)
    // Act
    await requestRemoval(harness, harness.studyId)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.studyRemoval?.status, 'failed')
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('Progress is not')),
      ),
      [
        `Error: Progress is not a regular file: ${ledgerPath}. Put the file itself at that path, or move what stands there away, then try again.`,
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused run started again with the same key after the learner made room is a new, admitted run; fails_when=the repeated key replays the refusal after a removal (0039-F17f); why_new=the reader tests started every run with a random key; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a start that repeats the key of a refused run after a removal made room begins a new run that prepares', async () => {
  // Arrange: a library full at one study and a run refused on it under a fixed key.
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const earlier = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const start = () =>
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: 'explain-the-theme',
      })
    const refusedReceipt = start(),
      refused = harness.service.record(refusedReceipt)
    await refused.preparation
    await waitUntil(() => refused.stopped, 'the end of the refused run')
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    await requestRemoval(harness, earlier.id)
    // Act
    const repeatedReceipt = start(),
      repeated = harness.service.record(repeatedReceipt)
    await repeated.preparation
    // Assert
    assert.equal(
      refused.error?.message,
      'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.',
    )
    assert.notEqual(repeatedReceipt.runId, refusedReceipt.runId)
    assert.equal(repeated.error, undefined)
    assert.equal(repeated.prepared, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a chosen saved study whose archive read fails after the learner closed the Study workspace adds no line about a study the reader no longer waits for; fails_when=the marker the close cleared is read as "the read succeeded and the arrangement failed" (0040-D6); why_new=the failed reads that are tested belong to an open reader; seam=the library's archive read, held and failed by the test
test('a chosen saved study whose archive read fails after the Study workspace was closed adds no reading or storage line', async (context) => {
  // Arrange: a study is shown; another is chosen and its archive read is held, then the Study workspace is closed.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    let readStarted!: () => void, failRead!: () => void
    const started = new Promise<void>((resolve) => {
        readStarted = resolve
      }),
      held = new Promise<void>((resolve) => {
        failRead = resolve
      })
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === chosen.id) {
          readStarted()
          await held
          throw new Error('The archive could not be read.')
        }
        return readCheckpoint.call(this, id)
      },
    )
    const opening = sendChoice(harness, 'history', chosen.id)
    await started
    await harness.reader.close()
    // Act
    failRead()
    await opening
    // Assert
    assert.deepEqual(
      structuredClone(
        harness.reader
          .inspect()
          .view!.errors.filter((line) =>
            line.includes('The archive could not be read.'),
          ),
      ),
      [],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a choice in the bottom panel of a closed Study workspace that cannot be read ends its loading state and shows why; fails_when=the bottom panel keeps loading beside the error until the reader is opened (0040-D3); why_new=the closed-reader choices that are tested all open; seam=the library's archive read, which fails
test('a saved study chosen in the bottom panel of a closed Study workspace whose archive cannot be read stops loading and names the failure', async (context) => {
  // Arrange: two saved studies; the older one is shown, then the Study workspace is closed and the bottom panel is resolved again. Reading the newer one fails.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    await harness.reader.close()
    await harness.resolveRestoredObservedMoments()
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === chosen.id) throw new Error('The archive could not be read.')
        return readCheckpoint.call(this, id)
      },
    )
    // Act
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      studyId: chosen.id,
      openRequest: 1,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    // Assert
    const panel = harness.playbackPanelMessages.at(-1)!
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(panel.loading, false)
    assert.equal(panel.model.selection.studyId, shown.id)
    assert.deepEqual(
      structuredClone(
        panel.errors.filter((line) =>
          line.includes('The archive could not be read.'),
        ),
      ),
      ['Error: The archive could not be read.'],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

/** Finishes a live run on a harness that already holds earlier saved studies, so its saved study is shown in the live arrangement and a saved study that follows it needs the reader arranged again. @example const liveStudyId = await finishLiveRun(harness) */
async function finishLiveRun(harness: Harness): Promise<string> {
  const { record } = await startRun(harness)
  const liveStudyId = `${harness.service.instanceId}_${record.id}`
  await harness.reader.open()
  await harness.reader.action('stop')
  await waitUntil(
    () =>
      harness.reader
        .inspect()
        .view!.studies.some((entry) => entry.id === liveStudyId),
    'the saved study of the finished run',
    2_000,
  )
  return liveStudyId
}

// Value: protects=a study the learner chose and saw while the neighbour of a removed study was being arranged stays shown and saved when that arrangement then fails; fails_when=the failed neighbour clears the selection, saves "no study" and shows a reading line about a study that was not asked for (0040-D1); why_new=the failed arrangement was only tested with nothing chosen meanwhile; seam=the reader's open, whose first call is held and then rejects
test('a saved study chosen and shown while the neighbour of a removed study is being arranged stays shown and saved when that arrangement fails', async () => {
  // Arrange: two earlier studies and the shown study of a finished live run; the neighbour's arrangement is held, later ones succeed.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const liveStudyId = await finishLiveRun(harness)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const open = harness.reader.open.bind(harness.reader)
    let arrangements = 0
    let arrangementStarted!: () => void, failArrangement!: () => void
    const started = new Promise<void>((resolve) => {
        arrangementStarted = resolve
      }),
      held = new Promise<void>((resolve) => {
        failArrangement = resolve
      })
    harness.reader.open = async (...openArguments): Promise<void> => {
      arrangements++
      if (arrangements > 1) return open(...openArguments)
      arrangementStarted()
      await held
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
    }
    // Act: the learner chooses another study while the neighbour is arranged; then that arrangement fails.
    const removal = requestRemoval(harness, liveStudyId)
    await started
    await sendChoice(harness, 'history', chosen.id)
    const shownBeforeFailure =
      harness.reader.inspect().view!.model.selection.studyId
    failArrangement()
    await removal
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(shownBeforeFailure, chosen.id)
    assert.equal(view.model.selection.studyId, chosen.id)
    assert.equal(view.study?.id, chosen.id)
    assert.equal((await library.readProgress()).selection?.studyId, chosen.id)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('presentation change')),
      ),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the reason a study could not be arranged is gone once the next study the learner chooses is shown; fails_when=the reading line stays until a pane is focused (0040-D7); why_new=the line's retirement was not tested; seam=the reader's open, which rejects once
test('the line that says why the study after a removal could not be arranged is gone once the learner chooses a saved study that is shown', async () => {
  // Arrange: a removal whose next study cannot be arranged leaves its reason in the reader.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
      harness,
      '2026-09-20T00:00:01.000Z',
    )
    const liveStudyId = await finishLiveRun(harness)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const open = harness.reader.open.bind(harness.reader)
    let arrangements = 0
    harness.reader.open = async (...openArguments): Promise<void> => {
      arrangements++
      if (arrangements > 1) return open(...openArguments)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
    }
    await requestRemoval(harness, liveStudyId)
    const linesAfterRemoval = harness.reader
      .inspect()
      .view!.errors.filter((line) => line.includes('presentation change'))
    // Act
    await sendChoice(harness, 'history', neighbour.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(linesAfterRemoval.length, 1)
    assert.equal(view.model.selection.studyId, neighbour.id)
    assert.deepEqual(
      structuredClone(
        view.errors.filter((line) => line.includes('presentation change')),
      ),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a reader that is still closing when the neighbour of a removed study has been read remembers that neighbour, as one that has finished closing does; fails_when=a close in progress makes the removal save an empty selection (0040-D11); why_new=only a reader that had finished closing was tested; seam=the reader's closing mark, set by the test as a close in progress sets it
test('a reader that is still closing when the neighbour of a removed study has been read remembers the neighbour', async (context) => {
  // Arrange: two studies; the newer one is shown and removed, and the read of its neighbour is held.
  const harness = await workspaceHarness()
  try {
    const library = await harness.reader.learningStorage()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    // Act: the read ends while a close is in progress.
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    readerSeams(harness).isClosing = true
    neighbourRead.release()
    await removal
    readerSeams(harness).isClosing = false
    // Assert
    assert.equal(
      (await library.readProgress()).selection?.studyId,
      neighbour.id,
    )
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      neighbour.id,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a study the learner chose is shown with its archive when a removal of the earlier shown study settles between that study's read and its showing; fails_when=the removal drops the archive the choice was holding, so the selection names a study the reader has no archive for (0040-D4); why_new=a removal was only settled before the read ended or after the study was shown; seam=the reader's retirement of a Node test history, held by the test, and the editor's Trash
test('a removal that settles after a chosen saved study was read and before it is shown leaves that study shown with its archive', async () => {
  // Arrange: the shown study's removal is moving files; the chosen study has been read and waits before it is shown.
  const harness = await workspaceHarness()
  try {
    const removed = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const retire = readerSeams(harness).nodeHistoryRetirement
    let retirementStarted!: () => void, continueRetirement!: () => void
    const started = new Promise<void>((resolve) => {
        retirementStarted = resolve
      }),
      held = new Promise<void>((resolve) => {
        continueRetirement = resolve
      })
    readerSeams(harness).nodeHistoryRetirement = async (): Promise<void> => {
      retirementStarted()
      await held
      await retire()
    }
    const trashMove = harness.holdTrashMove()
    const removal = requestRemoval(harness, removed.id)
    await trashMove.started
    const opening = sendChoice(harness, 'history', chosen.id)
    await started
    // Act: the removal settles, then the choice goes on.
    trashMove.release()
    await removal
    continueRetirement()
    await opening
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, chosen.id)
    assert.equal(view.study?.id, chosen.id)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner who returned to the current run while a removal was still reading the study that follows stays on that run; fails_when=the neighbour's late read selects the past study again, because only a chosen entry counted as overtaking it (X7-A.3); why_new=the neighbour was only overtaken by a chosen entry; seam=the library's archive read, held by the test
test('a return to the current run made while the neighbour of a removed study is being read is not undone by that neighbour', async (context) => {
  // Arrange: a current run, and two saved studies of which the newer one is shown and removed; the read of its neighbour is held.
  const harness = await workspaceHarness()
  try {
    const current = await startRun(harness)
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    // Act: the learner returns to the current run, then the neighbour's read ends.
    await harness.reader.action('return-current')
    const selectionAfterReturn = structuredClone(
      harness.reader.inspect().view!.model.selection,
    )
    neighbourRead.release()
    await removal
    // Assert
    const selection = harness.reader.inspect().view!.model.selection
    assert.equal(
      selectionAfterReturn.studyId,
      `${harness.service.instanceId}_${current.record.id}`,
    )
    assert.equal(selectionAfterReturn.follow, true)
    assert.deepEqual(structuredClone(selection), selectionAfterReturn)
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a Node test history the learner opened while the neighbour of a removed study was read keeps its own captured source; fails_when=the removal renders the saved-study selection over it and the source pane shows the saved-study placeholder (0040-D5); why_new=the Node test history was only asserted by its header; seam=the library's archive read, held by the test
test('a Node test history opened while the neighbour of a removed study is being read keeps the source it showed', async (context) => {
  // Arrange: two saved studies and a Node test history; the read of the removed study's neighbour is held.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    await sendChoice(harness, 'node-history', nodeHistory.studyId)
    // The open ends with its own publish, which a loaded machine can deliver after the choice's answer.
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          nodeHistory.studyId && !harness.reader.inspect().view?.loading,
      'the Node test history is open',
      2_000,
    )
    // The learner selects the history's recorded stop, which shows that stop's captured source in the historical debugger; the reader's `sourceUri` names only a saved study's source.
    const opened = harness.reader.inspect().view!
    await readerSeams(harness).receive(
      {
        type: 'node-history-stop',
        revision: opened.revision,
        studyId: nodeHistory.studyId,
        sequence: opened.nodeHistory!.entries.find(
          (entry) => entry.type === 'stop',
        )!.sequence,
      },
      'context',
    )
    const sourceOfNodeHistory = harness.reader.inspect().sourceUri
    const presentedSource =
        harness.historicalDebugPresentations.at(-1)?.sourceDocument?.uri,
      presentationsBefore = harness.historicalDebugPresentations.length,
      invalidationsBefore = harness.historicalDebugInvalidations()
    // Act
    neighbourRead.release()
    await removal
    // Assert
    const inspected = harness.reader.inspect()
    assert.equal(
      inspected.view!.nodeHistory?.header.studyId,
      nodeHistory.studyId,
    )
    // The stop's frames open the history's recorded-source slot (PR-B2, DS5).
    assert.equal(
      presentedSource?.includes(`/node-history-slot/${nodeHistory.studyId}/`),
      true,
    )
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
    assert.equal(harness.historicalDebugInvalidations(), invalidationsBefore)
    assert.equal(inspected.sourceUri, sourceOfNodeHistory)
    assert.equal(typeof sourceOfNodeHistory, 'string')
    assert.equal(inspected.view!.model.selection.studyId, undefined)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=display ownership while a test replay is selected: refreshes after the background saved-study selection changed leave the replay's source, its debugger and its selected stop as they were (EN9); fails_when=the periodic refresh renders the changed background selection over the replay and its source pane shows the saved-study placeholder; why_new=the refresh called renderSelection whenever no browser recording was active (the refresh's renderSelection branch, AC6); seam=the library's archive read, held by the test, and the refreshes the test runs; no_claim=native editor group behavior (N49)
test('refreshes after the background selection changed leave a selected test replay’s source and debugger on its stop', async (context) => {
  // Arrange: a saved study the learner removes while a test replay shows its stop.
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    const removal = requestRemoval(harness, removed.id)
    await neighbourRead.started
    await sendChoice(harness, 'node-history', nodeHistory.studyId)
    // The open ends with its own publish, which a loaded machine can deliver after the choice's answer.
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          nodeHistory.studyId && !harness.reader.inspect().view?.loading,
      'the Node test history is open',
      2_000,
    )
    const opened = harness.reader.inspect().view!
    await readerSeams(harness).receive(
      {
        type: 'node-history-stop',
        revision: opened.revision,
        studyId: nodeHistory.studyId,
        sequence: opened.nodeHistory!.entries.find(
          (entry) => entry.type === 'stop',
        )!.sequence,
      },
      'context',
    )
    neighbourRead.release()
    await removal
    const sourceOfStop = harness.reader.inspect().sourceUri
    const positionOfStop =
      harness.reader.inspect().view!.nodeHistoryPosition?.sequence
    const presentationsBefore = harness.historicalDebugPresentations.length,
      invalidationsBefore = harness.historicalDebugInvalidations()

    // Act: the reader's timer refreshes three times.
    for (let refresh = 0; refresh < 3; refresh++)
      await readerSeams(harness).refresh()

    // Assert
    const inspected = harness.reader.inspect()
    assert.equal(inspected.sourceUri, sourceOfStop)
    assert.equal(inspected.view!.nodeHistoryPosition?.sequence, positionOfStop)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
    assert.equal(harness.historicalDebugInvalidations(), invalidationsBefore)
    assert.equal(inspected.view!.model.selection.studyId, undefined)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a Node test history whose open is discarded because the reader changed meanwhile ends its loading state; fails_when=the handler returns for the changed revision and nothing clears `loading` (0040-ER-obs); why_new=only a saved study's discarded open was tested; seam=the Node history store's read, held by the test
test('a chosen Node test history whose open is discarded because the reader changed meanwhile stops loading', async (context) => {
  // Arrange: a recorded saved run is shown; a Node test history is chosen and its read is held. A recording open that fails meanwhile changes the reader's revision.
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await chooseStudy(harness, harness.studyId)
    const read = NodeTestHistoryStore.prototype.read
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => {
        entered = resolve
      }),
      released = new Promise<void>((resolve) => {
        release = resolve
      })
    context.mock.method(
      NodeTestHistoryStore.prototype,
      'read',
      async function (this: NodeTestHistoryStore, studyId: string) {
        entered()
        await released
        return read.call(this, studyId)
      },
    )
    const revisionAtChoice = harness.reader.inspect().view!.revision
    const opening = sendChoice(harness, 'node-history', nodeHistory.studyId)
    await started
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      throw new Error('The historical debugger did not start.')
    }
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording open',
      2_000,
    )
    // Act
    release()
    await opening
    // Assert
    const view = harness.reader.inspect().view!
    assert.notEqual(view.revision, revisionAtChoice)
    assert.equal(view.nodeHistory, undefined)
    assert.equal(view.loading, false)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

/** Rejects after a bound, so a test that would otherwise wait forever on two operations that wait for each other fails with a sentence. @example await Promise.race([both, failAfter(3_000, 'the save and the removal')]) */
function failAfter(milliseconds: number, awaited: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`Timed out waiting for ${awaited}.`)),
      milliseconds,
    ).unref()
  })
}

// Value: protects=a forced checkpoint of a removed study goes on once its files have moved, without waiting for the study that follows; fails_when=the checkpoint waits for the whole removal, neighbour read included (0039-F15); why_new=the wait was only tested for its end; seam=the library's archive read, held by the test
test('a forced checkpoint of a study whose files have moved ends while the study that follows is still being read', async (context) => {
  // Arrange: an earlier study and the recorded study of this window's stopped run, which is shown; the read of the neighbour is held.
  const harness = await recordedReaderHarness()
  try {
    const neighbour = await saveEarlierStudy(
      harness,
      '2026-09-20T00:00:01.000Z',
    )
    await chooseStudy(harness, harness.studyId)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const neighbourRead = holdArchiveRead(context, neighbour.id)
    const removal = requestRemoval(harness, harness.studyId)
    await neighbourRead.started
    // Act: a forced checkpoint, as retirement makes it.
    const checkpoint = readerSeams(harness).checkpoint(
      harness.service,
      harness.record,
      true,
    )
    // Assert
    await Promise.race([
      checkpoint,
      failAfter(2_000, 'the forced checkpoint during the neighbour read'),
    ])
    // The removed study was not written back by the checkpoint.
    assert.deepEqual(
      (await studyFiles(harness)).map(([name]) => name),
      [`${neighbour.id}.study.meta.v3.json`, `${neighbour.id}.study.v3.json`],
    )
    neighbourRead.release()
    await removal
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the final state of a run is saved when its removal moved nothing, also when the forced checkpoint was capturing at the confirmation; fails_when=the capture in flight is dropped and nothing writes the state afterwards (0039-F15); why_new=the capture in flight was only tested with a removal that moves the study; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a forced checkpoint that was capturing a study when its removal was confirmed is written once that removal moved nothing', async (context) => {
  // Arrange: a recorded, stopped and saved run with a captured image; the learner confirms while the next capture reads it, and the Trash refuses every move.
  const harness = await recordedReaderHarness(true)
  try {
    const saveStudy = LearningLibrary.prototype.saveStudy
    let studySaves = 0
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        studySaves++
        return saveStudy.call(this, study)
      },
    )
    harness.rejectTrashMoves(() => true)
    let confirm: ((answer: string) => void) | undefined
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === 1,
      'the confirmation dialog',
      1_000,
    )
    const runtime = harness.record.runtime!,
      view = runtime.view.bind(runtime)
    let capturing = false
    runtime.view = () => {
      // The capture reads the runtime again for its image; the confirmation arrives at that moment.
      if (capturing) {
        confirm?.(`Move to ${TRASH}`)
        confirm = undefined
      }
      return view()
    }
    // Act: a forced checkpoint, as Retry storage and retirement make it.
    capturing = true
    await Promise.race([
      readerSeams(harness).checkpoint(harness.service, harness.record, true),
      failAfter(3_000, 'the forced checkpoint'),
    ])
    capturing = false
    await removal
    // Assert
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'failed')
    assert.equal(studySaves, 1)
    assert.equal(
      harness.service.state(harness.record).historyOutcome.status,
      'saved',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a Save learning replay that is still stopping its run when the removal of that study is confirmed cannot lock the two against each other; fails_when=the save waits for the move and the move waits for the save (0039-F1); why_new=the service's stop returned at once in every test; seam=the service's stop, held by the test
test('a Save learning replay that is still stopping the run when its study’s removal is confirmed is answered as unavailable, and the removal completes', async () => {
  // Arrange: a recorded, stopped and saved run; the stop that Save learning replay repeats is held open.
  const harness = await recordedReaderHarness()
  try {
    const stop = harness.service.stop.bind(harness.service)
    let stopEntered!: () => void, releaseStop!: () => void
    const entered = new Promise<void>((resolve) => {
        stopEntered = resolve
      }),
      held = new Promise<void>((resolve) => {
        releaseStop = resolve
      })
    harness.service.stop = async (input) => {
      stopEntered()
      await held
      return stop(input)
    }
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const save = harness.reader.saveLearningReplay().then(
      () => 'saved',
      (error: unknown) => String(error),
    )
    await entered
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.reader.inspect().view!.studyRemoval?.status === 'moving',
      'the confirmed removal',
      2_000,
    )
    // Act
    releaseStop()
    const [saveAnswer] = await Promise.race([
      Promise.all([save, removal]),
      failAfter(3_000, 'the save and the removal'),
    ])
    // Assert
    assert.equal(saveAnswer, 'Error: Study archive is unavailable.')
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    await harness.close()
  }
})

// Value: protects=a Save learning replay whose checkpoint is capturing its study when the removal of that study is confirmed cannot lock the two against each other, and the removed study is not written back; fails_when=the capture waits for the move while the move waits for the save, so the removal stays "moving" and the save "saving" until the window is reloaded (Cycle 0044 review A-H1); why_new=the save was only tested while stopping its run and while writing, never with its capture in flight at the confirmation; seam=the service's stop, after which the runtime's view confirms the dialog
test('a Save learning replay that is capturing its study when the removal is confirmed is answered as unavailable, and the removal moves the study without it being written back', async () => {
  // Arrange: a recorded, stopped and saved run with a captured image; the learner confirms while the save's capture reads it.
  const harness = await recordedReaderHarness(true)
  try {
    const library = await harness.reader.learningStorage(),
      directory = harness.reader.inspect().libraryDirectory!
    let confirm: ((answer: string) => void) | undefined
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === 1,
      'the confirmation dialog',
      1_000,
    )
    const runtime = harness.record.runtime!,
      view = runtime.view.bind(runtime),
      stop = harness.service.stop.bind(harness.service)
    let capturing = false
    runtime.view = () => {
      // The capture reads the runtime again for its image; the confirmation arrives at that moment.
      if (capturing) {
        confirm?.(`Move to ${TRASH}`)
        confirm = undefined
      }
      return view()
    }
    harness.service.stop = async (input) => {
      const stopped = await stop(input)
      // The save's checkpoint is the next reader of the runtime.
      capturing = true
      return stopped
    }
    // Act
    const [saveAnswer] = await Promise.race([
      Promise.all([
        harness.reader.saveLearningReplay(harness.studyId).then(
          () => 'saved',
          (error: unknown) => String(error),
        ),
        removal,
      ]),
      failAfter(3_000, 'the save and the removal'),
    ])
    capturing = false
    // Assert
    assert.equal(saveAnswer, 'Error: Study archive is unavailable.')
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.deepEqual(await library.list(), [])
    assert.deepEqual(
      (await readdir(directory)).filter((name) =>
        name.includes(harness.studyId),
      ),
      [],
    )
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the state a Save learning replay captured is saved when the removal confirmed during that capture moved nothing; fails_when=the save and the removal wait for each other, or the capture is dropped and nothing writes the state afterwards (Cycle 0044 review A-H1); why_new=the capture in flight at the confirmation was only tested for a forced checkpoint outside a save; seam=the service's stop, after which the runtime's view confirms the dialog, and the editor's Trash, which refuses every move
test('a Save learning replay that was capturing its study when a removal that moved nothing was confirmed is answered as unavailable, and its capture is written once that removal has ended', async (context) => {
  // Arrange: a recorded, stopped and saved run with a captured image; the learner confirms while the save's capture reads it, and the Trash refuses every move.
  const harness = await recordedReaderHarness(true)
  try {
    const saveStudy = LearningLibrary.prototype.saveStudy
    let writtenStudies = 0
    let writtenBeforeRemovalEnded = 0
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        study: Parameters<LearningLibrary['saveStudy']>[0],
      ) {
        // Observe the write when it starts; the test may resume after an allowed later write has finished.
        if (harness.reader.inspect().view!.studyRemoval?.status === 'moving')
          writtenBeforeRemovalEnded++
        await saveStudy.call(this, study)
        writtenStudies++
      },
    )
    harness.rejectTrashMoves(() => true)
    let confirm: ((answer: string) => void) | undefined
    harness.answerWarningDialogs(
      ([answer]) =>
        new Promise<string | undefined>((resolve) => {
          confirm = (): void => resolve(answer)
        }),
    )
    const removal = requestRemoval(harness, harness.studyId)
    await waitUntil(
      () => harness.warningDialogs.length === 1,
      'the confirmation dialog',
      1_000,
    )
    const runtime = harness.record.runtime!,
      view = runtime.view.bind(runtime),
      stop = harness.service.stop.bind(harness.service)
    let capturing = false
    runtime.view = () => {
      // The capture reads the runtime again for its image; the confirmation arrives at that moment.
      if (capturing) {
        confirm?.(`Move to ${TRASH}`)
        confirm = undefined
      }
      return view()
    }
    harness.service.stop = async (input) => {
      const stopped = await stop(input)
      // The save's checkpoint is the next reader of the runtime.
      capturing = true
      return stopped
    }
    // Act
    const [saveAnswer] = await Promise.race([
      Promise.all([
        harness.reader.saveLearningReplay(harness.studyId).then(
          () => 'saved',
          (error: unknown) => String(error),
        ),
        removal,
      ]),
      failAfter(3_000, 'the save and the removal'),
    ])
    capturing = false
    await waitUntil(
      () =>
        writtenStudies === 1 &&
        harness.service.state(harness.record).historyOutcome.status ===
          'saved' &&
        readerSeams(harness).queuedStudyWrites() === 0,
      'the write of the capture the removal held back',
      2_000,
    )
    // Assert
    assert.equal(saveAnswer, 'Error: Study archive is unavailable.')
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'failed')
    assert.equal(writtenBeforeRemovalEnded, 0)
    assert.equal(
      harness.service.state(harness.record).historyOutcome.status,
      'saved',
    )
    assert.equal(readerSeams(harness).queuedStudyWrites(), 0)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the study being moved cannot be opened through the pane's list or through the playback controller; fails_when=either entry point reads or plays a half-moved study (0038-T9); why_new=the guard was only tested through the reader's own methods; seam=the editor's Trash, held by the test
test('while a saved study is being moved to the Trash, choosing it in the pane and opening its recording through the playback controller both answer that the archive is unavailable', async () => {
  // Arrange: the Trash holds the first move of the confirmed removal of a recorded study.
  const harness = await recordedReaderHarness()
  try {
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const held = harness.holdTrashMove()
    const removal = requestRemoval(harness, harness.studyId)
    await held.started
    // Act
    await sendChoice(harness, 'history', harness.studyId)
    const linesAfterPaneChoice = structuredClone(
      harness.reader
        .inspect()
        .view!.errors.filter((line) => line.includes('Study archive')),
    )
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the refused recording open',
      2_000,
    )
    const controllerReason = harness.controller.state().reason
    held.release()
    await removal
    // Assert
    assert.deepEqual(linesAfterPaneChoice, [
      'Error: Study archive is unavailable.',
    ])
    assert.equal(controllerReason, 'Error: Study archive is unavailable.')
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
  } finally {
    await harness.close()
  }
})

// Value: protects=a choice that was still opening when a removal settled and then fails leaves the reader without the removed study and with a delete button that works; fails_when=the failed choice restores the removed study or leaves its marker set (0039-F17c); why_new=a pending choice was only tested when it opens; seam=the library's archive read and the editor's Trash, both held by the test
test('a saved study that is still opening when a removal settles and then cannot be read leaves no removed study shown, and a delete request is asked', async (context) => {
  // Arrange: the shown study's removal is moving files; another entry is chosen, and its archive read is held and will fail.
  const harness = await workspaceHarness()
  try {
    const neighbour = await saveEarlierStudy(
        harness,
        '2026-09-20T00:00:01.000Z',
      ),
      removed = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:03.000Z')
    await chooseStudy(harness, removed.id)
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const trashMove = harness.holdTrashMove()
    const removal = requestRemoval(harness, removed.id)
    await trashMove.started
    const readCheckpoint = LearningLibrary.prototype.readCheckpoint
    let readStarted!: () => void, failRead!: () => void
    const started = new Promise<void>((resolve) => {
        readStarted = resolve
      }),
      held = new Promise<void>((resolve) => {
        failRead = resolve
      })
    context.mock.method(
      LearningLibrary.prototype,
      'readCheckpoint',
      async function (this: LearningLibrary, id: string) {
        if (id === chosen.id) {
          readStarted()
          await held
          throw new Error('The archive could not be read.')
        }
        return readCheckpoint.call(this, id)
      },
    )
    const opening = sendChoice(harness, 'history', chosen.id)
    await started
    // Act: the removal settles, then the choice fails; the learner asks to delete the neighbour and cancels.
    trashMove.release()
    await removal
    failRead()
    await opening
    harness.answerWarningDialogs(async () => undefined)
    await requestRemoval(harness, neighbour.id)
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.model.selection.studyId, undefined)
    assert.equal(view.study, undefined)
    assert.equal(view.loading, false)
    assert.equal(harness.warningDialogs.length, 2)
    assert.equal(view.studyRemoval, undefined)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a test that asserts which pane was answered fails when the reply goes to another panel; fails_when=the harness records every panel's reply as `context` (0040-CR); why_new=the harness named the panel kind by a constant; seam=none
test('a reply to an open request that reaches the application panel is recorded under that panel’s own kind, not as the Study pane', async () => {
  // Arrange: an open reader with its Study pane and its application panel.
  const harness = await workspaceHarness()
  try {
    await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.open()
    const applicationPanel = harness
      .nativePanels()
      .find((panel) => panel.viewType === 'codebook.scopedBrowser')
    assert.ok(applicationPanel)
    // Act
    await applicationPanel.webview.postMessage({
      type: 'open-request-settled',
      openRequest: 9,
    })
    // Assert
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'codebook.scopedBrowser', openRequest: 9 },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused choice during a Recording load that another request started is answered at once; fails_when=the reply of a rejected message is kept for a load that message never started (0040-D10); why_new=a refused choice during Recording was only tested with no load in flight; seam=none
test('a saved study chosen with an outdated view while another recording load is in flight is answered at once', async () => {
  // Arrange: a saved recorded run whose recording is open; a choice starts another recording load, which is held.
  const harness = await recordedReaderHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    let failLoad!: () => void, loadEntered!: () => void
    const loadStarted = new Promise<void>((resolve) => {
        loadEntered = resolve
      }),
      loadHeld = new Promise<void>((resolve) => {
        failLoad = resolve
      })
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      loadEntered()
      await loadHeld
      throw new Error('The historical debugger did not start.')
    }
    sendFromPane(harness, {
      type: 'history',
      studyId: other.id,
      openRequest: 5,
    })
    await loadStarted
    // Act: a second choice carries the revision of an earlier view and is rejected.
    harness.receive({
      type: 'history',
      revision: harness.reader.inspect().view!.revision - 1,
      studyId: other.id,
      openRequest: 6,
    })
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const repliesWhileLoading = harness.openRequestReplies()
    failLoad()
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the failed recording load',
      2_000,
    )
    // Assert
    assert.deepEqual(repliesWhileLoading, [
      { webview: 'summary', openRequest: 6 },
    ])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'summary', openRequest: 6 },
      { webview: 'summary', openRequest: 5 },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=a message from a panel that is disposed while the message is handled ends with the message's own outcome; fails_when=the reply step asks the disposed panel for its webview and its error replaces that outcome (0040-D10); why_new=the webview was read after the message was handled; seam=a panel whose webview throws once the test disposes it, as the editor's does
test('an open request from a panel that is disposed while its message is handled ends without a disposal error', async () => {
  // Arrange: a panel whose webview throws once the panel is disposed.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    let isDisposed = false
    const replies: unknown[] = []
    const disposedPanel = {
      get webview() {
        if (isDisposed) throw new Error('Webview is disposed')
        return {
          postMessage: async (message: unknown): Promise<boolean> => {
            replies.push(message)
            return true
          },
        }
      },
    }
    // Act
    const handled = readerSeams(harness).receiveFromPanel(
      {
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId: study.id,
        openRequest: 4,
      },
      'context',
      disposedPanel,
    )
    // The panel is disposed while its message is still being handled.
    isDisposed = true
    // Assert
    await assert.doesNotReject(handled)
    assert.deepEqual(structuredClone(replies), [
      { type: 'open-request-settled', openRequest: 4 },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=Retry storage is offered for what it can answer, and a refused control does not stay through the learner's later choices; fails_when=a layout notice or a refused control counts as a storage failure, or the refusal line outlives the next choice that works (0039-N8-c, 0040-N9-1, 0040-N9-2); why_new=every error line counted as retryable; seam=none
test('a refused pane control is counted as not retryable and its line is gone once the learner’s next choice is handled', async () => {
  // Arrange: two saved studies; a choice with the revision of an earlier view is refused through the pane.
  const harness = await workspaceHarness()
  try {
    const first = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      second = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, first.id)
    harness.receive({
      type: 'history',
      revision: harness.reader.inspect().view!.revision - 1,
      studyId: second.id,
    })
    await waitUntil(
      () => harness.reader.inspect().view!.errors.length === 1,
      'the refused control',
      1_000,
    )
    const refused = structuredClone(harness.reader.inspect().view!)
    // Act
    sendFromPane(harness, { type: 'history', studyId: second.id })
    // The refusal's line is retired after the choice itself was handled and published, so the wait is for the retired line too: a read between the two publishes still holds it.
    await waitUntil(
      () => {
        const handled = harness.reader.inspect().view!
        return (
          handled.model.selection.studyId === second.id &&
          !handled.loading &&
          handled.errors.length === 0
        )
      },
      'the chosen saved study without the refused control’s line',
      1_000,
    )
    // Assert
    assert.deepEqual(refused.errors, [
      'Error: The displayed study changed. Inspect the current view before acting.',
    ])
    assert.equal(refused.unretryableErrorCount, 1)
    const view = harness.reader.inspect().view!
    assert.deepEqual(structuredClone(view.errors), [])
    assert.equal(view.unretryableErrorCount, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved study chosen in the bottom panel while the Study workspace is opening is published once, by the open's own render, and the pane's reply follows the Study message that names it; fails_when=the choice ends the loading state before the open renders (0040-OCR3), or the reply reaches the pane before the Study message that shows the entry (0040-OCR2); why_new=a choice was only made on a reader that is closed or open; seam=the reader's storage initialisation, whose first call (the open's) is held by the test
test('a saved study chosen in the bottom panel while the Study workspace is opening stays loading until the open has rendered it, and is named before its pane is answered', async () => {
  // Arrange: two saved studies; the older one is shown, then the Study workspace is closed and the bottom panel is resolved again. The next open is held at its first step.
  const harness = await workspaceHarness()
  try {
    const shown = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z'),
      chosen = await saveEarlierStudy(harness, '2026-09-20T00:00:02.000Z')
    await chooseStudy(harness, shown.id)
    await harness.reader.close()
    await harness.resolveRestoredObservedMoments()
    const initialize = readerSeams(harness).initialization
    let initializations = 0
    let continueOpen!: () => void
    const openHeld = new Promise<void>((resolve) => {
      continueOpen = resolve
    })
    readerSeams(harness).initialization = async (): Promise<void> => {
      if (initializations++ === 0) await openHeld
      await initialize()
    }
    const opening = harness.reader.open()
    // Act: the learner chooses the other study in the bottom panel while the open waits.
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      studyId: chosen.id,
      openRequest: 1,
    })
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the reply to the open request',
      1_000,
    )
    // Read at the moment the reply reached the panel, not after the wait: by then a Study message posted after the reply has arrived too.
    const panelAtReply = harness.playbackPanelMessageAtReply(1)!
    continueOpen()
    await opening
    // Assert
    assert.equal(panelAtReply.model.selection.studyId, chosen.id)
    assert.equal(panelAtReply.loading, true)
    const panel = harness.playbackPanelMessages.at(-1)!
    assert.equal(panel.model.selection.studyId, chosen.id)
    assert.equal(panel.loading, false)
    assert.equal(harness.reader.inspect().opened, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a pane that chose a saved study during Recording is answered only when that recording load has ended, also when the playback controller reports a change in the middle of the load; fails_when=any change callback posts the kept reply while the load is still in flight (0040-D12b); why_new=the kept reply was only tested with no callback between the start and the end of the load; seam=the reader's debugger replacement, held by the test inside the load
test('a saved study chosen during Recording is not answered by a playback change in the middle of its recording load, only once that load has ended', async () => {
  // Arrange: a saved recorded run whose recording is open; the next recording load is held.
  const harness = await recordedReaderHarness()
  try {
    const other = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    let endLoad!: () => void, loadEntered!: () => void
    const loadStarted = new Promise<void>((resolve) => {
        loadEntered = resolve
      }),
      loadHeld = new Promise<void>((resolve) => {
        endLoad = resolve
      })
    readerSeams(harness).debuggerReplacement = async (): Promise<void> => {
      loadEntered()
      await loadHeld
      throw new Error('The historical debugger did not start.')
    }
    sendFromPane(harness, {
      type: 'history',
      studyId: other.id,
      openRequest: 8,
    })
    await loadStarted
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    // Act: the controller reports a change while the load is in flight; then the load ends.
    readerSeams(harness).reportPlaybackChange()
    const readinessAtChange = harness.controller.state().readiness,
      repliesAtChange = harness.openRequestReplies()
    endLoad()
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the end of the recording load',
      2_000,
    )
    // Assert
    assert.equal(readinessAtChange, 'loading')
    assert.deepEqual(repliesAtChange, [])
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'summary', openRequest: 8 },
    ])
  } finally {
    await harness.close()
  }
})

/**
 * Leaves an unsealed recording of a run, started on 2026-10-01 at 08:00 UTC, and names its writer: an editor that crashed (a process id of no process, another host, or a later process that got the id) or, with a live child process of the test, an editor window of this machine that still writes it.
 * `header-only` makes it a recording of 0.2.29.0 (no record of its writer beside the recordings); `with-record` keeps the record this build writes and names the writer there too, with the writer's own process start, and the recording by its folder and its creation time.
 * @param harness - The reader whose library holds the study.
 * @param study - The run: a saved study, or a run that saved none ({@link unsavedRunOf}).
 * @param owner - The writer: its process id and its host name.
 * @param record - Whether the recording has the record of its writer.
 * @returns The recording's directory.
 * @example await unsealedRecordingOf(harness, study, { pid: 2 ** 22 + 1, hostname: 'old-laptop.local' }, 'header-only')
 */
async function unsealedRecordingOf(
  harness: Harness,
  study: Pick<
    Awaited<ReturnType<typeof saveEarlierStudy>>,
    'workspaceKey' | 'id' | 'instanceId' | 'runId' | 'profile'
  >,
  owner: { pid: number; hostname: string },
  record: 'header-only' | 'with-record',
): Promise<string> {
  const directory = harness.reader.inspect().libraryDirectory!
  await new RecordingStore(directory, study.workspaceKey).start(
    {
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  const folder = join(directory, 'recordings.v2', study.id)
  const header: { owner: Record<string, unknown> } = JSON.parse(
    await readFile(join(folder, 'header.json'), 'utf8'),
  )
  await writeFile(
    join(folder, 'header.json'),
    JSON.stringify({
      ...header,
      owner: { ...header.owner, ...owner },
      createdAt: '2026-10-01T08:00:00.000Z',
    }),
  )
  const recordPath = recordingOwnerRecordPath(directory, study.id)
  if (record === 'header-only') await rm(recordPath)
  else
    await rewriteWriterRecord(directory, study.id, {
      ...owner,
      processStart: await readProcessStart(owner.pid),
      recording: {
        folder: 'recordings.v2',
        createdAt: '2026-10-01T08:00:00.000Z',
      },
    })
  return folder
}

/** The dialog that offers "Move to Trash Anyway" for a recording of old-laptop.local started on 2026-10-01 at 08:00 UTC, as the reader opens it. */
const DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST = {
  title: `This study's recording may still be in use on another computer. Move the study to the ${TRASH} anyway?`,
  options: {
    modal: true,
    detail: `Its recording was started on old-laptop.local at ${new Date('2026-10-01T08:00:00.000Z').toLocaleString()}. Codebook cannot tell from this computer whether an editor window still records it or still has to save it. If a window still records it or still has to save it, on that computer or on this one, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.`,
  },
  items: [`Move to ${TRASH} Anyway`],
}

// Value: protects=a learner whose saved study has the recording an editor left when it crashed on this Mac under an earlier host name (macOS takes it from the network), or on another computer, which Codebook cannot probe; fails_when=the removal refuses for good with "Another editor window has not finished recording and saving this study", although no such window exists, and nothing else can remove the study; why_new=Cycle 0046 OCR review OC1: R9's refusal took a recording of another host for a live writer of this machine; seam=the recording's header (another host, no record of its writer, as 0.2.29.0 leaves it), and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a saved study whose crashed recording names another host is moved with its recording after the learner chooses Move to Trash Anyway in a dialog that names that host and the recording’s start', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves.map((move) => basename(move.path)),
        studyRemoval: structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        ),
      },
      {
        dialogs: [DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST],
        moved: [
          study.id,
          `${study.id}.study.meta.v3.json`,
          `${study.id}.study.v3.json`,
        ],
        studyRemoval: {
          status: 'moved',
          studyId: study.id,
          text: `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved study whose recording another computer that shares this storage folder wrote, with the record of its writer this build keeps; fails_when=the record of another machine is judged 'may-run' (the plain refusal returns, OC1's dead end), or the dialog takes the host from the header, so it names this computer (TC3); why_new=Cycle 0046 testing review TC3: every removal test used a header-only recording; seam=the recording's header, which names this host and a process id of no process, its writer record, which names machine-b and old-laptop.local, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a saved study whose recording’s writer record names another machine is moved with its recording after the learner chooses Move to Trash Anyway in a dialog that names the record’s host', async () => {
  // Arrange: the header names this host; the record of the writer names machine-b under the host name old-laptop.local.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: hostname() },
      'with-record',
    )
    await rewriteWriterRecord(
      harness.reader.inspect().libraryDirectory!,
      study.id,
      { machineId: 'machine-b', hostname: 'old-laptop.local' },
    )
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves.map((move) => basename(move.path)),
        studyRemoval: harness.reader.inspect().view!.studyRemoval?.status,
      },
      {
        dialogs: [DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST],
        moved: [
          study.id,
          `${study.id}.study.meta.v3.json`,
          `${study.id}.study.v3.json`,
        ],
        studyRemoval: 'moved',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's consent to each recording that the removal moves although its writer may still run on another computer; fails_when=the dialog names only one of the study's recordings and "Move to Trash Anyway" then moves the other too, unnamed (AD6, probe p3 E3); why_new=Cycle 0046 adversarial review AD6; seam=two recordings of the study (recordings.v2 by the helper, recordings.v3 by hand), each a header of another host without a record of its writer, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a saved study whose recordings name two other hosts is moved with both after the learner chooses Move to Trash Anyway in a dialog that names both hosts and starts', async () => {
  // Arrange: the recordings.v2 recording names old-laptop.local (2026-10-01); a recordings.v3 one names other-desktop.local (2026-10-17).
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    const secondRecording = join(
      harness.reader.inspect().libraryDirectory!,
      'recordings.v3',
      study.id,
    )
    await mkdir(secondRecording, { recursive: true })
    await writeFile(
      join(secondRecording, 'header.json'),
      JSON.stringify({
        owner: {
          pid: ID_OF_NO_PROCESS,
          hostname: 'other-desktop.local',
          sessionId: randomUUID(),
        },
        createdAt: '2026-10-17T08:00:00.000Z',
      }),
    )
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves.map((move) =>
          join(basename(dirname(move.path)), basename(move.path)),
        ),
      },
      {
        dialogs: [
          {
            title: `Some of this study's recordings may still be in use on another computer. Move the study to the ${TRASH} anyway?`,
            options: {
              modal: true,
              detail: `Its recordings were started on other-desktop.local at ${new Date('2026-10-17T08:00:00.000Z').toLocaleString()} and on old-laptop.local at ${new Date('2026-10-01T08:00:00.000Z').toLocaleString()}. Codebook cannot tell from this computer whether an editor window still records them or still has to save them. If a window still records one of them or still has to save it, on another computer or on this one, that recording is lost. If none does, nothing is lost. Cancel keeps the study and its recordings as they are.`,
            },
            items: [`Move to ${TRASH} Anyway`],
          },
        ],
        moved: [
          join('recordings.v3', study.id),
          join('recordings.v2', study.id),
          join(
            basename(harness.reader.inspect().libraryDirectory!),
            `${study.id}.study.meta.v3.json`,
          ),
          join(
            basename(harness.reader.inspect().libraryDirectory!),
            `${study.id}.study.v3.json`,
          ),
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Saved studies line while the learner reads the dialog about a recording that may still run on another computer, and after their Cancel; fails_when=the line says "Moving the saved study to the Trash…" while nothing moves and the learner has not chosen yet, or the removal stays held after Cancel (PD4); why_new=Cycle 0046 design review PD4; seam=the recording's header (another host, no record of its writer), and the editor's dialogs, stubbed at the vscode boundary: the test reads the line when the second dialog opens
test('while the dialog about a recording on another computer is open the removal waits for the learner’s confirmation, and Cancel ends it with no line', async () => {
  // Arrange: the learner confirms the removal, then cancels the dialog about the recording; the line is read as that dialog opens.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    let lineWhileTheDialogIsOpen: unknown
    harness.answerWarningDialogs(async ([button]) => {
      if (button !== `Move to ${TRASH} Anyway`) return button
      lineWhileTheDialogIsOpen = structuredClone(
        harness.reader.inspect().view!.studyRemoval,
      )
      return undefined
    })

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        lineWhileTheDialogIsOpen,
        lineAfterCancel: harness.reader.inspect().view!.studyRemoval,
        moved: harness.trashMoves,
      },
      {
        lineWhileTheDialogIsOpen: { status: 'confirming', studyId: study.id },
        lineAfterCancel: undefined,
        moved: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Saved studies line once the learner chose to move a study whose recording may still run on another computer; fails_when=the line stays "confirming" while the files move, or the move starts before the line says so (PD4); why_new=Cycle 0046 design review PD4; seam=the recording's header (another host, no record of its writer), and the editor's dialogs and Trash, stubbed at the vscode boundary: the test reads the line as the first file moves
test('after Move to Trash Anyway the removal is shown as moving again while the files move, and ends as moved', async () => {
  // Arrange: the learner confirms both dialogs; the line is read as the dialog opens and as the first file moves.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    let lineWhileTheDialogIsOpen: unknown
    const linesWhileMoving: unknown[] = []
    harness.answerWarningDialogs(async ([button]) => {
      if (button === `Move to ${TRASH} Anyway`)
        lineWhileTheDialogIsOpen = structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        )
      return button
    })
    harness.beforeTrashMoves(async () => {
      linesWhileMoving.push(
        structuredClone(harness.reader.inspect().view!.studyRemoval),
      )
    })

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        lineWhileTheDialogIsOpen,
        lineAsTheFirstFileMoves: linesWhileMoving[0],
        lineAtTheEnd: harness.reader.inspect().view!.studyRemoval?.status,
      },
      {
        lineWhileTheDialogIsOpen: { status: 'confirming', studyId: study.id },
        lineAsTheFirstFileMoves: {
          status: 'moving',
          studyId: study.id,
          text: `Moving the saved study to the ${TRASH}…`,
        },
        lineAtTheEnd: 'moved',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's consent to each recording the removal moves, when another computer starts writing a recording of the study while the dialog is open; fails_when="Move to Trash Anyway" judges every writer again and moves the recording the dialog never named with the one it named (S2, probe: host-two written while the dialog was open, and both moved); why_new=Cycle 0046 Claude adversarial review #3 (S2); seam=the study's recordings.v2 header of old-laptop.local, a recordings.v3 header of other-desktop.local the test writes while the second dialog waits, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a recording of another host that appears while the dialog is open keeps the study after Move to Trash Anyway, and the line names both recordings', async () => {
  // Arrange: the dialog names old-laptop.local; before the learner answers, a recording of other-desktop.local appears.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    const appearing = join(
      harness.reader.inspect().libraryDirectory!,
      'recordings.v3',
      study.id,
    )
    harness.answerWarningDialogs(async ([button]) => {
      if (button === `Move to ${TRASH} Anyway`) {
        await mkdir(appearing, { recursive: true })
        await writeFile(
          join(appearing, 'header.json'),
          JSON.stringify({
            owner: {
              pid: ID_OF_NO_PROCESS,
              hostname: 'other-desktop.local',
              sessionId: randomUUID(),
            },
            createdAt: '2026-10-17T08:00:00.000Z',
          }),
        )
      }
      return button
    })

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: harness.warningDialogs.length,
        moved: harness.trashMoves,
        studyRemoval: structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        ),
      },
      {
        dialogs: 2,
        moved: [],
        studyRemoval: {
          status: 'failed',
          studyId: study.id,
          text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Its recordings were started on other-desktop.local at ${new Date('2026-10-17T08:00:00.000Z').toLocaleString()} and on old-laptop.local at ${new Date('2026-10-01T08:00:00.000Z').toLocaleString()}. Codebook cannot tell from this computer whether an editor window still records them or still has to save them.`,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Saved studies line when the editor cannot show the dialog about a recording that may still run on another computer (the host rejects the modal dialog); fails_when=the removal stays 'confirming' for good after that rejection, since only a 'moving' removal is cleared when the move ends, so no later delete can start and the line waits for an answer that never comes (TT7, PD4's finally); why_new=Cycle 0046 third testing review TT7: no test rejected the second dialog; seam=the editor's dialogs, stubbed at the vscode boundary: the first is confirmed, the second rejects
test('a dialog about a recording on another computer that the editor cannot show ends the removal with no line, and the study stays listed', async () => {
  // Arrange: the learner confirms the removal; the editor then fails to show the dialog about the recording.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    harness.answerWarningDialogs(async ([button]) => {
      if (button === `Move to ${TRASH} Anyway`)
        throw new Error('The window could not show the dialog.')
      return button
    })

    // Act
    await requestRemoval(harness, study.id).catch(() => undefined)

    // Assert
    assert.deepEqual(
      {
        studyRemoval: harness.reader.inspect().view!.studyRemoval,
        moved: harness.trashMoves,
        listed: harness.reader
          .inspect()
          .view!.studies.some((entry) => entry.id === study.id),
      },
      { studyRemoval: undefined, moved: [], listed: true },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's Cancel in the dialog about a recording that may still run on another computer; fails_when=Cancel moves the study or its recording anyway, or leaves the removal shown as failed or still moving; why_new=Cycle 0046 OCR review OC1; seam=the recording's header (another host, no record of its writer), and the editor's dialogs and Trash, stubbed at the vscode boundary
test('Cancel in the dialog about a recording that names another host moves nothing and leaves the study as it was', async () => {
  // Arrange: the learner confirms the removal, then cancels the dialog about the recording.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const recording = await unsealedRecordingOf(
      harness,
      study,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    harness.answerWarningDialogs(async ([button]) =>
      button === `Move to ${TRASH} Anyway` ? undefined : button,
    )
    const library = await harness.reader.learningStorage()

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves,
        studyRemoval: harness.reader.inspect().view!.studyRemoval,
        listed: (await library.list()).map((entry) => entry.id),
        recordingLeft: await readdir(recording),
      },
      {
        dialogs: [DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST],
        moved: [],
        studyRemoval: undefined,
        listed: [study.id],
        recordingLeft: ['frames.jsonl', 'header.json'],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved study whose recording (header alone) names a process of this computer that is alive but began, by the clock, after the recording: another process that got the id, or the writer itself after a step of the clock; fails_when=the wall-clock comparison is taken as certain, so the writer counts as gone and the removal moves the recording without the learner's choice; why_new=Cycle 0046 Codex review CX13; seam=the recording's header, which names a live child process of the test that began after the recording's creation time, without a record of its writer, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a saved study whose recording names a live process of this computer begun after the recording reaches the dialog, and Move to Trash Anyway moves it', async (context: TestContext) => {
  // Arrange: the recording was created on 2026-10-01; the live process that has its id now began after it.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const laterProcess = await idleChild(context)
    await unsealedRecordingOf(
      harness,
      study,
      { pid: laterProcess.pid!, hostname: hostname() },
      'header-only',
    )
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: harness.warningDialogs.map((dialog) => dialog.items),
        moved: harness.trashMoves.map((move) => basename(move.path)),
        studyRemoval: harness.reader.inspect().view!.studyRemoval?.status,
      },
      {
        dialogs: [[`Move to ${TRASH}`], [`Move to ${TRASH} Anyway`]],
        moved: [
          study.id,
          `${study.id}.study.meta.v3.json`,
          `${study.id}.study.v3.json`,
        ],
        studyRemoval: 'moved',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's reading of the dialog about a recording whose writer is a live process of this computer that began, by the clock, after the recording; fails_when=the dialog says the recording may still be in use "on another computer" and that this computer cannot tell, although the writer would be an editor window of this very computer (CX13's case, PD3); why_new=Cycle 0046 design review PD3: the dialog had one title and detail for both places; seam=the recording's header, which names a live child process of the test that began after the recording's creation time, without a record of its writer, and the editor's dialogs, stubbed at the vscode boundary
test('the dialog about a recording that a live process of this computer begun after it may still write says that another editor window may still be recording it, and what is lost', async (context: TestContext) => {
  // Arrange: the recording was created on 2026-10-01; the live process that has its id now began after it. The learner cancels the dialog.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const laterProcess = await idleChild(context)
    await unsealedRecordingOf(
      harness,
      study,
      { pid: laterProcess.pid!, hostname: hostname() },
      'header-only',
    )
    harness.answerWarningDialogs(async ([button]) =>
      button === `Move to ${TRASH} Anyway` ? undefined : button,
    )

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(structuredClone(harness.warningDialogs.slice(1)), [
      {
        title: `This study's recording may still be in use in another editor window. Move the study to the ${TRASH} anyway?`,
        options: {
          modal: true,
          detail: `Its recording was started on ${hostname()} at ${new Date('2026-10-01T08:00:00.000Z').toLocaleString()}. Codebook cannot tell whether an editor window of this computer still records it or still has to save it. If a window still records it or still has to save it, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.`,
        },
        items: [`Move to ${TRASH} Anyway`],
      },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's Cancel in the dialog about a recording that a live process of this computer begun after it may still write; fails_when=Cancel there moves the study or its recording anyway, or leaves the removal shown, although another editor window of this computer may still be recording it; why_new=Cycle 0046 second /ship state-machine review SM1: the cell unconfirmed-here x cancel-anyway had no test of what stays; seam=the recording's header, which names a live child process of the test that began after the recording's creation time, without a record of its writer, and the editor's dialogs and Trash, stubbed at the vscode boundary; no_claim=the dialog's words, which the test above holds
test('Cancel in the dialog about a recording that a live process of this computer begun after it may still write moves nothing and leaves the study as it was', async (context: TestContext) => {
  // Arrange: the recording was created on 2026-10-01; the live process that has its id now began after it. The learner confirms the removal, then cancels the dialog about the recording.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const laterProcess = await idleChild(context)
    const recording = await unsealedRecordingOf(
      harness,
      study,
      { pid: laterProcess.pid!, hostname: hostname() },
      'header-only',
    )
    harness.answerWarningDialogs(async ([button]) =>
      button === `Move to ${TRASH} Anyway` ? undefined : button,
    )
    const library = await harness.reader.learningStorage()

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: harness.warningDialogs.map((dialog) => dialog.items),
        moved: harness.trashMoves,
        studyRemoval: harness.reader.inspect().view!.studyRemoval,
        listed: (await library.list()).map((entry) => entry.id),
        // A recording that was moved is read as gone, so a Cancel taken for the confirmation fails here and not in the read.
        recordingLeft: await readdir(recording).catch((): string[] => []),
      },
      {
        dialogs: [[`Move to ${TRASH}`], [`Move to ${TRASH} Anyway`]],
        moved: [],
        studyRemoval: undefined,
        listed: [study.id],
        recordingLeft: ['frames.jsonl', 'header.json'],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a study whose recording another editor window of this machine is still writing, which the learner gets no way to remove; fails_when=a writer this machine can prove alive (its record names this machine, and the live process has the recorded start) is offered "Move to Trash Anyway", so the learner removes a recording while it is written; why_new=Cycle 0046 OCR review OC1: only a writer this machine cannot probe gets the learner's choice; seam=the recording's header and the record of its writer, which name a live child process of the test with its own start, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a saved study whose recording a live window of this machine is still writing is refused, and no Move to Trash Anyway is offered', async (context: TestContext) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const otherWindow = await idleChild(context)
    await unsealedRecordingOf(
      harness,
      study,
      { pid: otherWindow.pid!, hostname: hostname() },
      'with-record',
    )
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: harness.warningDialogs.map((dialog) => dialog.items),
        moved: harness.trashMoves,
        studyRemoval: structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        ),
      },
      {
        dialogs: [[`Move to ${TRASH}`]],
        moved: [],
        studyRemoval: {
          status: 'failed',
          studyId: study.id,
          text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.`,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a study one of whose recordings a live window of this machine still writes, while another of its recordings names another host; fails_when=the writer on another host is found first and the learner is offered "Move to Trash Anyway", which moves the recording a live window still writes (TC2: swapping the two checks of the removal survived every test); why_new=Cycle 0046 testing review TC2: no study had both kinds of writer, and review AF10: the record of one recording no longer judges the other; seam=the recordings.v2 recording's header and record, which name a live child process of the test with its own start, the recordings.v3 header of old-laptop.local without a record, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a saved study with a recording a live window of this machine still writes and one that names another host is refused plainly, and no Move to Trash Anyway is offered', async (context: TestContext) => {
  // Arrange: recordings.v2 is written by a live window of this machine, which its record names with its start; recordings.v3 names old-laptop.local in its header alone. The record names recordings.v2, so it judges that recording only.
  const harness = await workspaceHarness()
  try {
    const study = await saveEarlierStudy(harness, '2026-09-20T00:00:01.000Z')
    const otherWindow = await idleChild(context)
    await unsealedRecordingOf(
      harness,
      study,
      { pid: otherWindow.pid!, hostname: hostname() },
      'with-record',
    )
    const ofAnotherHost = join(
      harness.reader.inspect().libraryDirectory!,
      'recordings.v3',
      study.id,
    )
    await mkdir(ofAnotherHost, { recursive: true })
    await writeFile(
      join(ofAnotherHost, 'header.json'),
      JSON.stringify({
        owner: {
          pid: ID_OF_NO_PROCESS,
          hostname: 'old-laptop.local',
          sessionId: randomUUID(),
        },
        createdAt: '2026-10-01T08:00:00.000Z',
      }),
    )
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, study.id)

    // Assert
    assert.deepEqual(
      {
        dialogs: harness.warningDialogs.map((dialog) => dialog.items),
        moved: harness.trashMoves,
        studyRemoval: structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        ),
      },
      {
        dialogs: [[`Move to ${TRASH}`]],
        moved: [],
        studyRemoval: {
          status: 'failed',
          studyId: study.id,
          text: `The saved study could not be moved to the ${TRASH}. Nothing was deleted. Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.`,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the study of a recorded run whose release failed after it sealed the recording (a browser that did not close): the save of the checkpoint taken once that stop had ended gives up the record of the recording's writer, which is what tells another window that a run still holds the recording, so Delete there removes the study instead of refusing it with "Save its learning replay in that window", advice that could not help; a checkpoint taken before the seal and written after it still gives up nothing; fails_when=only an archive that says the run stopped gives the record up, so a run whose stop failed after the seal holds its recording for as long as its window lives (Cycle 0047 row 140), or the release is judged when the archive is written instead of when its checkpoint was taken, so the write of a checkpoint from before the seal gives the record up and another window may remove the study before the run's state after the seal is saved (row 124's race back); why_new=Cycle 0047 row 140 (P3OCR2-1 = P3CLA-7); seam=the reader's own refresh timer, stopped so that the test's refreshes are the only checkpoints, the runtime's release, which rejects, and the library's study save, whose first call the test holds while a second checkpoint waits behind it and the run stops; no_claim=a second editor window's Delete, which judges the record by the same look (studyRemoval tests)
test('a recorded run whose release fails after the seal gives up its recording’s writer record with the save of the checkpoint taken after that stop, and not with the save of one taken before the seal', async (context) => {
  // Arrange: a recorded run of this window, paused at its stop and saved; the save of its next checkpoint is held, a later checkpoint taken before the seal waits behind it, and the run's release then fails.
  const harness = await workspaceHarness(true, true)
  try {
    readerSeams(harness).stopOwnTimer()
    // A run records only for a build whose source is identified.
    harness.service.environment.build.sourceHash = sha256('recorded-build')
    harness.acknowledgeContext()
    const { receipt, record } = await startRun(harness)
    record.recording!.frame({
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        'base64',
      ),
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(100)
    await harness.reader.action('click')
    await waitUntil(
      () => harness.service.state(record).historyOutcome.status === 'saved',
      'the save of the paused run',
      2_000,
    )
    const studyId = `${harness.service.instanceId}_${record.id}`,
      recordingDirectory = join(
        harness.reader.inspect().libraryDirectory!,
        'recordings.v2',
        studyId,
      )
    const saveStudy = LearningLibrary.prototype.saveStudy
    const isWriterRecordLeftAfterEachSave: boolean[] = []
    let studySaves = 0
    let releaseFirstSave!: () => void
    const firstSaveHeld = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        ...saved: Parameters<LearningLibrary['saveStudy']>
      ) {
        studySaves++
        if (studySaves === 1) await firstSaveHeld
        await saveStudy.apply(this, saved)
        isWriterRecordLeftAfterEachSave.push(
          (await lookAtRecording(recordingDirectory)).hasWriterRecord,
        )
      },
    )
    const explainBeforeTheStop = (key: string, interpretation: string) =>
      harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key,
        snapshotUri:
          harness.service.state(record).participants.browser.snapshotUri!,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation,
      })
    await explainBeforeTheStop('held-save', 'The theme was dark.')
    await readerSeams(harness).refresh()
    await waitUntil(
      () => studySaves === 1,
      'the held save of a checkpoint taken before the seal',
      2_000,
    )
    await explainBeforeTheStop(
      'waiting-checkpoint',
      'The theme was still dark.',
    )
    await readerSeams(harness).refresh()
    const runtime = harness.runtimes[0]!,
      stopRuntime = runtime.stop.bind(runtime)
    runtime.stop = async (): Promise<void> => {
      throw new Error('owned browser close: timed out')
    }
    harness.clock(200)

    // Act: the run's stop fails after the seal; the held save ends and the checkpoint that waited behind it is written; then a checkpoint is taken after the stop.
    const stop = await harness.service.stop(receipt).then(
      () => 'stopped',
      (error: unknown) => String(error),
    )
    // The harness's own shutdown releases the run once the test has read it.
    runtime.stop = stopRuntime
    releaseFirstSave()
    await waitUntil(
      () => isWriterRecordLeftAfterEachSave.length === 2,
      'the writes of the two checkpoints taken before the seal',
      2_000,
    )
    await readerSeams(harness).refresh()
    await waitUntil(
      () => isWriterRecordLeftAfterEachSave.length === 3,
      'the save of the checkpoint taken after the stop',
      2_000,
    )
    const library = await harness.reader.learningStorage()

    // Assert
    assert.deepEqual(
      {
        stop,
        isRecordingSealed: (await lookAtRecording(recordingDirectory)).isSealed,
        savedState: (await library.readStudy(studyId)).state,
        isWriterRecordLeftAfterEachSave,
      },
      {
        stop: 'Error: owned browser close: timed out',
        isRecordingSealed: true,
        savedState: 'paused-browser',
        isWriterRecordLeftAfterEachSave: [true, true, false],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the study of a recorded run whose checkpoint is taken while its stop is still under way after the seal: the save of that checkpoint keeps the record of the recording's writer, so another window neither lists the recording nor removes the study while the run's state after its stop is not saved, and the save of the checkpoint taken after the stop gives it up; fails_when=a checkpoint taken while the stop runs counts as one taken after the stop ended (service.ts hasStopEndedAfterSeal without its `!record.stopping`), so its save gives the record up before the run's final state is saved, and another window may delete the study, whose final save then finds it gone (Cycle 0047 row 200, state cell U39); why_new=Cycle 0047 row 200 (S2SM-U39): no test took a checkpoint between the seal and the end of the stop; seam=the reader's own refresh timer, stopped so that the test's refreshes are the only checkpoints, the recording store's read that the stop makes right after the seal, which the test holds, and the library's study save, after which the test looks at the writer record; no_claim=a second editor window's Delete, which judges the record by the same look (studyRemoval tests)
test('a checkpoint taken while a recorded run’s stop is under way after the seal keeps the recording’s writer record, and the checkpoint taken after the stop gives it up', async (context) => {
  // Arrange: a recorded run of this window, paused at its stop and saved; the stop's read of the recording right after the seal is held.
  const harness = await workspaceHarness(true, true)
  try {
    readerSeams(harness).stopOwnTimer()
    // A run records only for a build whose source is identified.
    harness.service.environment.build.sourceHash = sha256('recorded-build')
    harness.acknowledgeContext()
    const { receipt, record } = await startRun(harness)
    record.recording!.frame({
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        'base64',
      ),
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(100)
    await harness.reader.action('click')
    await waitUntil(
      () => harness.service.state(record).historyOutcome.status === 'saved',
      'the save of the paused run',
      2_000,
    )
    const recordingDirectory = join(
      harness.reader.inspect().libraryDirectory!,
      'recordings.v2',
      `${harness.service.instanceId}_${record.id}`,
    )
    const saveStudy = LearningLibrary.prototype.saveStudy
    const isWriterRecordLeftAfterEachSave: boolean[] = []
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        ...saved: Parameters<LearningLibrary['saveStudy']>
      ) {
        await saveStudy.apply(this, saved)
        isWriterRecordLeftAfterEachSave.push(
          (await lookAtRecording(recordingDirectory)).hasWriterRecord,
        )
      },
    )
    const store = harness.service.recordings!,
      read = store.read.bind(store)
    let isReadAfterTheSealHeld = false
    let releaseReadAfterTheSeal!: () => void
    const readAfterTheSeal = new Promise<void>((resolve) => {
      releaseReadAfterTheSeal = resolve
    })
    context.mock.method(
      store,
      'read',
      async (...input: Parameters<typeof store.read>) => {
        // Only the stop's first read once the recording is sealed is held.
        if (record.recording?.isSealed && !isReadAfterTheSealHeld) {
          isReadAfterTheSealHeld = true
          await readAfterTheSeal
        }
        return read(...input)
      },
    )
    harness.clock(200)

    // Act: the run stops; while its stop is under way after the seal a checkpoint is taken; then the stop ends and a checkpoint is taken after it.
    const stop = harness.service.stop(receipt).then(
      () => 'stopped',
      (error: unknown) => String(error),
    )
    await waitUntil(
      () => isReadAfterTheSealHeld,
      'the seal of the recording during the stop',
      2_000,
    )
    const hasStopEndedWhileItRuns =
      harness.service.hasStopEndedAfterSeal(record)
    await readerSeams(harness).refresh()
    await waitUntil(
      () => isWriterRecordLeftAfterEachSave.length === 1,
      'the save of the checkpoint taken while the stop runs',
      2_000,
    )
    releaseReadAfterTheSeal()
    const stopOutcome = await stop
    await readerSeams(harness).refresh()
    await waitUntil(
      () => isWriterRecordLeftAfterEachSave.length === 2,
      'the save of the checkpoint taken after the stop',
      2_000,
    )

    // Assert
    assert.deepEqual(
      {
        hasStopEndedWhileItRuns,
        stopOutcome,
        isWriterRecordLeftAfterEachSave,
      },
      {
        hasStopEndedWhileItRuns: false,
        stopOutcome: 'stopped',
        isWriterRecordLeftAfterEachSave: [true, false],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a study whose run in this window has stopped and saved it, which another window then deletes with its recording: the run's next checkpoint (an explanation saved after the stop, as an agent's learning summary is) does not write the archive back without its recording, the run's history ends as removed, and the reader no longer lists the study; fails_when=the library writes the archive whenever the run's checkpoint asks, so the study the learner deleted comes back without its recording, the outcome the writer record was kept to prevent (Cycle 0047 row 162); why_new=Cycle 0047 row 162 (CORE3-2): row 124 releases the writer record at the first save that says the run stopped, and a run that stays in the window is saved again; seam=a second LearningLibrary over the same storage, which removes the study as another window's Delete does (its mover deletes what it is given), and the reader's own refresh timer, stopped so that the test's refresh is the only checkpoint; no_claim=a learning summary's own content (any explanation takes the same checkpoint), a second editor process
test('a stopped and saved run whose study another window deletes with its recording does not write the study back at its next checkpoint, and its history ends as removed', async () => {
  // Arrange: a recorded run of this window, stopped and saved; another window deletes its study, archive and recording.
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const directory = harness.reader.inspect().libraryDirectory!,
      library = await harness.reader.learningStorage()
    const otherWindow = new LearningLibrary(directory, library.workspaceKey)
    const movedByTheOtherWindow: string[] = []
    const removal = await otherWindow.removeStudy(
      harness.studyId,
      async (path) => {
        movedByTheOtherWindow.push(relative(directory, path))
        await rm(path, { recursive: true })
      },
    )

    // Act: an agent saves an explanation of the stopped run, and the reader takes its checkpoint.
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'after-the-deletion',
      snapshotUri: harness.service.state(harness.record).participants.browser
        .snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The theme was dark when the run stopped.',
    })
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(harness.record).historyOutcome.status !==
        'pending',
      'the end of the checkpoint after the deletion',
      2_000,
    )

    // Assert
    const history = harness.service.state(harness.record).historyOutcome
    assert.deepEqual(
      {
        removal: { ...removal },
        movedByTheOtherWindow,
        filesOfTheStudy: (await readdir(directory)).filter((name) =>
          name.startsWith(harness.studyId),
        ),
        recordings: await readdir(join(directory, 'recordings.v2')),
        listed: (await library.list()).map((entry) => entry.id),
        history: { status: history.status, reason: history.reason },
      },
      {
        removal: { outcome: 'moved' },
        movedByTheOtherWindow: [
          join('recordings.v2', harness.studyId),
          `${harness.studyId}.study.meta.v3.json`,
          `${harness.studyId}.study.v3.json`,
        ],
        filesOfTheStudy: [],
        recordings: [],
        listed: [],
        history: {
          status: 'unavailable',
          reason:
            "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the pane's storage line of a study that another window deleted with its recording after one of its saves failed here: once the next save is refused and this window forgets the study, no "History not saved: …" line is left for a study that no longer waits; fails_when=the refused save forgets the study and its pending archive but keeps the line of the earlier failure until Retry storage / refresh, so the learner reads that a history is not saved, and is offered a retry, for a study that was deleted (Cycle 0047 row 256); why_new=Cycle 0047 row 256 (P3MAINT-6): row 162's test had no earlier failed save; seam=the library's study save, which fails once with ENOSPC, a second LearningLibrary over the same storage, which removes the study as another window's Delete does (its mover deletes what it is given), and the reader's own refresh timer, stopped so that the test's refreshes are the only checkpoints; no_claim=a real full disk, a second editor process
test('a study whose save failed and that another window then deletes with its recording leaves no "History not saved: …" line once its next save is refused', async (context) => {
  // Arrange: a recorded run of this window, stopped and saved; the save of its next checkpoint fails once, and another window then deletes its study, archive and recording.
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const directory = harness.reader.inspect().libraryDirectory!,
      library = await harness.reader.learningStorage()
    const saveStudy = LearningLibrary.prototype.saveStudy
    let hasSaveFailed = false
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        ...input: Parameters<LearningLibrary['saveStudy']>
      ) {
        // Only the first save of the test fails, as a full disk refuses it.
        if (!hasSaveFailed) {
          hasSaveFailed = true
          throw Object.assign(
            new Error('ENOSPC: no space left on device, write'),
            { code: 'ENOSPC' },
          )
        }
        return saveStudy.apply(this, input)
      },
    )
    const explainAndCheckpoint = async (
      key: string,
      interpretation: string,
      endsWhen: (status: string) => boolean,
    ): Promise<void> => {
      await harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: harness.record.id,
        key,
        snapshotUri: harness.service.state(harness.record).participants.browser
          .snapshotUri!,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation,
      })
      await readerSeams(harness).refresh()
      await waitUntil(
        () =>
          endsWhen(harness.service.state(harness.record).historyOutcome.status),
        'the end of the checkpoint',
        2_000,
      )
    }
    await explainAndCheckpoint(
      'before-the-deletion',
      'The theme was dark when the run stopped.',
      (status) => status === 'failed',
    )
    const linesAfterTheFailedSave = structuredClone(
      harness.reader.inspect().view!.errors,
    )
    const removal = await new LearningLibrary(
      directory,
      library.workspaceKey,
    ).removeStudy(harness.studyId, async (path) => {
      await rm(path, { recursive: true })
    })

    // Act: an agent saves another explanation of the stopped run, and the reader takes its checkpoint, whose save the library refuses.
    await explainAndCheckpoint(
      'after-the-deletion',
      'The theme stayed dark after the stop.',
      (status) => status === 'unavailable',
    )

    // Assert
    assert.deepEqual(
      {
        linesAfterTheFailedSave,
        removal: { ...removal },
        linesAfterTheRefusedSave: structuredClone(
          harness.reader.inspect().view!.errors,
        ),
        listed: (await library.list()).map((entry) => entry.id),
      },
      {
        linesAfterTheFailedSave: [
          'Error: History not saved: Error: ENOSPC: no space left on device, write',
        ],
        removal: { outcome: 'moved' },
        linesAfterTheRefusedSave: [],
        listed: [],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

/**
 * Has an agent save one more explanation of the stopped run of a recorded reader and lets the reader take the checkpoint of it; used by the tests of the line "History not saved: …" after a removal.
 * @param harness - A recorded reader whose own refresh timer is stopped.
 * @param key - The key of the explanation.
 * @example await explainStoppedRunAndCheckpoint(harness, 'after-the-failure')
 */
async function explainStoppedRunAndCheckpoint(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
  key: string,
): Promise<void> {
  await harness.service.explain({
    instanceId: harness.service.instanceId,
    runId: harness.record.id,
    key,
    snapshotUri: harness.service.state(harness.record).participants.browser
      .snapshotUri!,
    sourceHash: sha256('const nextTheme = "dark";\n'),
    valuePaths: ['value:nextTheme'],
    interpretation: 'The theme was dark when the run stopped.',
  })
  await readerSeams(harness).refresh()
  await waitUntil(
    () =>
      harness.service.state(harness.record).historyOutcome.status === 'failed',
    'the failed checkpoint',
    2_000,
  )
}

// Value: protects=the pane of a study whose newest save failed and that the learner then moves to the Trash with Delete: the line "History not saved: …" and its Retry storage / refresh go with the study, because no archive waits for a write any more; fails_when=the removal drops the waiting archive and the run's failed receipt but keeps the line, so the learner reads that a history is not saved and is offered Retry for a study that is gone (Cycle 0048 task 123); why_new=Cycle 0048 task 123 (CodeRabbit: forgetRemovedStudy kept the line); seam=the library's study save, which refuses every write while the test says so, the editor's dialog and Trash, stubbed at the vscode boundary, and the reader's own refresh timer, stopped so that the test's refresh is the only checkpoint; no_claim=wording of the line, Move to Trash Anyway
test('the line “History not saved: …” goes with a study whose save failed when the learner moves it to the Trash, and no write waits', async (context) => {
  // Arrange: a recorded run of this window, saved once; the disk then refuses the next checkpoint, which leaves the line and a waiting archive.
  const disk = refuseStudySaves(context)
  disk.refusesEveryStudy = false
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    disk.refusesEveryStudy = true
    await explainStoppedRunAndCheckpoint(harness, 'after-the-failure')
    const afterTheFailedSave = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
    })

    // Act: the learner deletes the study.
    await requestRemoval(harness, harness.studyId)

    // Assert
    assert.deepEqual(
      {
        afterTheFailedSave,
        afterTheRemoval: {
          queued: readerSeams(harness).queuedStudyWrites(),
          errors: structuredClone(harness.reader.inspect().view!.errors),
          listed: (await (await harness.reader.learningStorage()).list()).map(
            (entry) => entry.id,
          ),
        },
      },
      {
        afterTheFailedSave: {
          queued: 1,
          errors: ['Error: History not saved: Error: disk is read-only'],
        },
        afterTheRemoval: { queued: 0, errors: [], listed: [] },
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line "History not saved: …" and the Retry button beside it for another study whose archive still waits, when the learner moves a study with a failed save to the Trash; fails_when=the removal takes the line from the pane whatever other studies are unsaved, so the learner loses Retry although the second run's study is unsaved; why_new=Cycle 0048 task 123 (CodeRabbit: the clear of the line must keep task 64's rule); seam=the library's study save, which refuses every write while the test says so, a second run of the same server whose checkpoint is refused, the editor's dialog and Trash, stubbed at the vscode boundary, and the reader's own refresh timer, stopped so that the test's refresh is the only checkpoint; no_claim=wording of the line
test('the line “History not saved: …” stays with Retry storage / refresh beside it when the learner moves a study to the Trash while another study still waits to be saved', async (context) => {
  // Arrange: a recorded run saved once whose next checkpoint is refused, and a second run whose first save is refused too.
  const disk = refuseStudySaves(context)
  disk.refusesEveryStudy = false
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    disk.refusesEveryStudy = true
    await explainStoppedRunAndCheckpoint(harness, 'after-the-failure')
    const second = await startRun(harness)
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(second.record).historyOutcome.status === 'failed',
      'the failed checkpoint of the second run',
      2_000,
    )

    // Act: the learner deletes the first study.
    await requestRemoval(harness, harness.studyId)

    // Assert
    assert.deepEqual(
      {
        queued: readerSeams(harness).queuedStudyWrites(),
        errors: structuredClone(harness.reader.inspect().view!.errors),
        unretryableErrorCount:
          harness.reader.inspect().view!.unretryableErrorCount,
      },
      {
        queued: 1,
        errors: ['Error: History not saved: Error: disk is read-only'],
        unretryableErrorCount: 0,
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line "History not saved: …" and the Retry button beside it for a study whose capture failed before any write, when another study of this window is deleted by another window with its recording and its next save is refused; fails_when=the forget of the removed study takes the line of a failed save from the pane whatever other studies are unsaved, so the learner loses the line and its Retry although the first study is unsaved; why_new=Cycle 0048 task 64 (pass 1 of the second /ship): the test of the refused save after a deletion has one study only, and the capture failure test has no deletion; seam=the capture step ({@link captureStudy}), which fails for the second study until the test says otherwise, a second LearningLibrary over the same storage, which deletes the first study with its recording, and the reader's own refresh timer, stopped so that the test's refresh is the only checkpoint; no_claim=wording of the line, a second editor process
test('the line “History not saved: …” of a study whose capture failed stays, with Retry storage / refresh beside it, when another study is deleted with its recording by another window, and is gone once Retry saved that study', async (context) => {
  // Arrange: a recorded run of this window, stopped and saved; a second run of the same server stops and its capture fails, so its study never waits in the write queue.
  const capture = captureStudyModule.captureStudy
  let failedStudyId: string | undefined
  context.mock.method(
    captureStudyModule,
    'captureStudy',
    (...args: Parameters<typeof capture>) =>
      failedStudyId === `${args[0].instanceId}_${args[1].id}`
        ? Promise.reject(new Error('capture is unavailable'))
        : capture(...args),
  )
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const directory = harness.reader.inspect().libraryDirectory!,
      library = await harness.reader.learningStorage()
    const second = await startRun(harness)
    failedStudyId = `${harness.service.instanceId}_${second.record.id}`
    await harness.reader.action('stop')
    const afterCaptureFailure = structuredClone({
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    // Another window deletes the first study with its recording.
    const removal = await new LearningLibrary(
      directory,
      library.workspaceKey,
    ).removeStudy(harness.studyId, async (path) => {
      await rm(path, { recursive: true })
    })

    // Act: an agent saves another explanation of the first, stopped run, and the reader takes its checkpoint, whose save the library refuses; then the capture works again and the learner presses Retry storage / refresh.
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'after-the-deletion',
      snapshotUri: harness.service.state(harness.record).participants.browser
        .snapshotUri!,
      sourceHash: sha256('const nextTheme = "dark";\n'),
      valuePaths: ['value:nextTheme'],
      interpretation: 'The theme stayed dark after the stop.',
    })
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(harness.record).historyOutcome.status ===
        'unavailable',
      'the end of the checkpoint after the deletion',
      2_000,
    )
    const afterRefusedSave = structuredClone({
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
    })
    failedStudyId = undefined
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        removal: { ...removal },
        afterRefusedSave,
        errorsAfterRetry: structuredClone(
          harness.reader.inspect().view!.errors,
        ),
        secondHistory: harness.service.state(second.record).historyOutcome
          .status,
      },
      {
        afterCaptureFailure: {
          errors: ['Error: History not saved: Error: capture is unavailable'],
          unretryableErrorCount: 0,
        },
        removal: { outcome: 'moved' },
        // The line and Retry storage / refresh stay for the second study.
        afterRefusedSave: {
          errors: ['Error: History not saved: Error: capture is unavailable'],
          unretryableErrorCount: 0,
        },
        errorsAfterRetry: [],
        secondHistory: 'saved',
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the line "History not saved: …" going once the only study with a failed checkpoint has no run in this window any more, when another study is saved: Retry storage / refresh cannot checkpoint a run this window does not hold, so the line would offer it for ever; fails_when=a failed receipt of a study without a run here keeps the line (the check for the study's run in the count of unsaved history is dropped), so the learner reads that a history is not saved after another study was saved, and Retry saves nothing; why_new=Cycle 0048 task 127 (Step 7 gap): the test of task 64 uses a study that has a run; seam=the capture step ({@link captureStudy}), which fails for the stopped second run, the service's run list, from which the test drops that run, and the reader's own refresh timer, stopped so that the test's refresh is the only checkpoint; no_claim=how a run leaves the service, wording of the line
test('the line “History not saved: …” of a study whose capture failed and whose run this window no longer holds goes when another study is saved', async (context) => {
  // Arrange: a recorded run of this window, stopped and saved; a second run stops and its capture fails, which leaves the line and no waiting archive; then the service no longer holds the second run.
  const capture = captureStudyModule.captureStudy
  let failedStudyId: string | undefined
  context.mock.method(
    captureStudyModule,
    'captureStudy',
    (...args: Parameters<typeof capture>) =>
      failedStudyId === `${args[0].instanceId}_${args[1].id}`
        ? Promise.reject(new Error('capture is unavailable'))
        : capture(...args),
  )
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const failed = await startRun(harness)
    failedStudyId = `${harness.service.instanceId}_${failed.record.id}`
    await harness.reader.action('stop')
    const afterCaptureFailure = structuredClone({
      queued: readerSeams(harness).queuedStudyWrites(),
      errors: harness.reader.inspect().view!.errors,
    })
    harness.service.records.delete(failed.record.id)

    // Act: a third run of the same server is saved by the reader's checkpoint.
    const third = await startRun(harness)
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(third.record).historyOutcome.status === 'saved',
      'the save of the third run',
      2_000,
    )

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        afterOtherSave: structuredClone(harness.reader.inspect().view!.errors),
      },
      {
        afterCaptureFailure: {
          queued: 0,
          errors: ['Error: History not saved: Error: capture is unavailable'],
        },
        afterOtherSave: [],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

/**
 * Records a second run of this window beside a first, stopped and saved one; the reader's refresh saves the second run while it is live, and its Stop then fails in the capture, so that the reader is left with the failed receipt of that run ("History not saved: Error: capture is unavailable"), no archive waiting for a write, and the study's files on disk.
 * @param context - The test whose mocks the caller restores.
 * @returns The harness (its own timer stopped), the second run's study id, and `makeCaptureWork`, after which the capture of every study works again.
 * @example
 * const failed = await recordRunWithFailedCapture(context)
 * failed.makeCaptureWork()
 * await failed.harness.reader.action('retry') // checkpoints the run again
 */
async function recordRunWithFailedCapture(context: TestContext) {
  const capture = captureStudyModule.captureStudy
  let failedStudyId: string | undefined
  context.mock.method(
    captureStudyModule,
    'captureStudy',
    (...args: Parameters<typeof capture>) =>
      failedStudyId === `${args[0].instanceId}_${args[1].id}`
        ? Promise.reject(new Error('capture is unavailable'))
        : capture(...args),
  )
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const second = await startRun(harness),
      studyId = `${harness.service.instanceId}_${second.record.id}`
    // The refresh saves the live run's study: its files are on disk before the failure.
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.service.state(second.record).historyOutcome.status === 'saved',
      'the save of the second run',
      2_000,
    )
    failedStudyId = studyId
    await harness.reader.action('stop')
    return {
      harness,
      record: second.record,
      studyId,
      makeCaptureWork(): void {
        failedStudyId = undefined
      },
    }
  } catch (error) {
    await harness.close()
    throw error
  }
}

/**
 * Reads what the pane shows of a failed save and what waits for a write.
 * @param harness - A recorded reader.
 * @returns The number of archives that wait, the pane's lines, and how many of them Retry storage / refresh does not answer (Retry is offered while the lines outnumber these).
 * @example readerState(harness) // => { queued: 0, errors: [], unretryableErrorCount: 0 }
 */
function readerState(
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
) {
  const view = harness.reader.inspect().view!
  return structuredClone({
    queued: readerSeams(harness).queuedStudyWrites(),
    errors: view.errors,
    unretryableErrorCount: view.unretryableErrorCount,
  })
}

const FAILED_CAPTURE_STATE = {
  queued: 0,
  errors: ['Error: History not saved: Error: capture is unavailable'],
  unretryableErrorCount: 0,
}
const NO_LINE_STATE = { queued: 0, errors: [], unretryableErrorCount: 0 }

// Value: protects=the pane of a study whose last checkpoint failed in its capture (a failed receipt, no waiting archive) and that the learner then moves to the Trash with Delete: the line "History not saved: …" and Retry storage / refresh go with the study; fails_when=the removal forgets only a waiting archive and keeps the failed receipt of the run this window holds, so the learner reads that a history is not saved and is offered Retry for a study that is gone; why_new=Cycle 0048 task 129 (state machines: the removals were tested for a waiting archive only); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, the editor's dialog and Trash, stubbed at the vscode boundary, and the reader's own refresh timer, stopped so that the test's refresh is the only checkpoint; no_claim=wording of the line
test('the line “History not saved: …” of a study whose capture failed goes when the learner moves that study to the Trash, and no Retry storage / refresh is offered', async (context) => {
  // Arrange: a recorded run of this window, saved once, whose next checkpoint failed in its capture.
  const { harness, studyId } = await recordRunWithFailedCapture(context)
  try {
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const afterCaptureFailure = readerState(harness)

    // Act: the learner deletes the study.
    await requestRemoval(harness, studyId)

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        afterTheRemoval: readerState(harness),
        listed: (await (await harness.reader.learningStorage()).list()).map(
          (entry) => entry.id,
        ),
      },
      {
        afterCaptureFailure: FAILED_CAPTURE_STATE,
        afterTheRemoval: NO_LINE_STATE,
        listed: [harness.studyId],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose last checkpoint failed in its capture (a failed receipt, no waiting archive) and whose files the learner then removed by hand: the press on Retry storage / refresh forgets the study, writes nothing for it and leaves no line and no Retry; fails_when=the forget of a study that left the library keeps the failed receipt of the run this window holds, so the line stays and Retry checkpoints the run, which writes the study back beside the removal; why_new=Cycle 0048 task 129 (state machines: the removals were tested for a waiting archive only); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, and the file system, on which the test removes the study's files; no_claim=wording of the line
test('the line “History not saved: …” of a study whose capture failed goes when its files were removed by hand and Retry storage / refresh was pressed, and that Retry writes nothing for it', async (context) => {
  // Arrange: as above; the learner removes every file of the study, and the capture works again.
  const { harness, studyId, makeCaptureWork } =
    await recordRunWithFailedCapture(context)
  try {
    const afterCaptureFailure = readerState(harness)
    await removeStudyFilesByHand(harness, studyId)
    makeCaptureWork()

    // Act: the learner presses Retry storage / refresh.
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        afterRetry: readerState(harness),
        listed: (await (await harness.reader.learningStorage()).list()).map(
          (entry) => entry.id,
        ),
      },
      {
        afterCaptureFailure: FAILED_CAPTURE_STATE,
        afterRetry: NO_LINE_STATE,
        listed: [harness.studyId],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose last checkpoint failed in its capture (a failed receipt, no waiting archive) and that another window then deletes with its recording: when this window's save at Retry storage / refresh is refused, the study is forgotten, with its line and Retry; fails_when=the forget after a refused save keeps the failed receipt of the run this window holds, so the line and Retry stay for a study that is gone and Retry would capture it again; why_new=Cycle 0048 task 129 (state machines: the removals were tested for a waiting archive only; the deletion test of task 64 deletes another study); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, and a second LearningLibrary over the same storage, which deletes the study with its recording; no_claim=wording of the line, a second editor process
test('the line “History not saved: …” of a study whose capture failed goes when another window deleted that study with its recording and the save of Retry storage / refresh is refused, and no Retry is offered', async (context) => {
  // Arrange: as above; another window deletes the study with its recording, and the capture works again.
  const { harness, studyId, makeCaptureWork } =
    await recordRunWithFailedCapture(context)
  try {
    const afterCaptureFailure = readerState(harness)
    const library = await harness.reader.learningStorage()
    const removal = await new LearningLibrary(
      harness.reader.inspect().libraryDirectory!,
      library.workspaceKey,
    ).removeStudy(studyId, async (path) => {
      await rm(path, { recursive: true })
    })
    makeCaptureWork()

    // Act: the learner presses Retry storage / refresh, whose checkpoint of the run reaches the library, which refuses the save of a study that left it.
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        removal: { ...removal },
        afterRefusedSave: readerState(harness),
        listed: (await library.list()).map((entry) => entry.id),
      },
      {
        afterCaptureFailure: FAILED_CAPTURE_STATE,
        removal: { outcome: 'moved' },
        afterRefusedSave: NO_LINE_STATE,
        listed: [harness.studyId],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose capture failed and whose run this window no longer holds, when the learner presses Retry storage / refresh: Retry cannot checkpoint a run that is not here, so the line and the offer go; fails_when=a failed receipt of a study without a run here keeps the line after Retry (the check for the study's run in the count of unsaved history is dropped, or Retry leaves the line), so the learner is offered Retry for ever and it saves nothing; why_new=Cycle 0048 task 129 (state machines: the run-less failed receipt was tested only under another study's save); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, and the service's run list, from which the test drops the run; no_claim=how a run leaves the service, wording of the line
test('the line “History not saved: …” of a study whose capture failed and whose run this window no longer holds goes when Retry storage / refresh is pressed', async (context) => {
  // Arrange: as above, and the service no longer holds the run.
  const { harness, record, makeCaptureWork } =
    await recordRunWithFailedCapture(context)
  try {
    const afterCaptureFailure = readerState(harness)
    harness.service.records.delete(record.id)
    makeCaptureWork()

    // Act: the learner presses Retry storage / refresh.
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      { afterCaptureFailure, afterRetry: readerState(harness) },
      { afterCaptureFailure: FAILED_CAPTURE_STATE, afterRetry: NO_LINE_STATE },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose capture failed and whose run this window no longer holds, when the learner moves that study to the Trash; fails_when=the removal of a study without a run here keeps its failed receipt or its line, so the learner is offered Retry for a study that is gone; why_new=Cycle 0048 task 129 (state machines: the run-less failed receipt was tested only under another study's save); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, the service's run list, from which the test drops the run, and the editor's dialog and Trash, stubbed at the vscode boundary; no_claim=how a run leaves the service, wording of the line
test('the line “History not saved: …” of a study whose capture failed and whose run this window no longer holds goes when the learner moves that study to the Trash', async (context) => {
  // Arrange: as above, and the service no longer holds the run.
  const { harness, record, studyId } = await recordRunWithFailedCapture(context)
  try {
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    const afterCaptureFailure = readerState(harness)
    harness.service.records.delete(record.id)

    // Act: the learner deletes the study.
    await requestRemoval(harness, studyId)

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        afterTheRemoval: readerState(harness),
        listed: (await (await harness.reader.learningStorage()).list()).map(
          (entry) => entry.id,
        ),
      },
      {
        afterCaptureFailure: FAILED_CAPTURE_STATE,
        afterTheRemoval: NO_LINE_STATE,
        listed: [harness.studyId],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose capture failed and whose run this window no longer holds, when the learner removed the study's files by hand and presses Retry storage / refresh; fails_when=the forget of a study that left the library keeps the failed receipt of a study without a run here, or Retry writes the study back, so the line stays or the study returns beside the removal; why_new=Cycle 0048 task 129 (state machines: the run-less failed receipt was tested only under another study's save); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, the service's run list, from which the test drops the run, and the file system, on which the test removes the study's files; no_claim=how a run leaves the service, wording of the line
test('the line “History not saved: …” of a study whose capture failed and whose run this window no longer holds goes when its files were removed by hand and Retry storage / refresh was pressed', async (context) => {
  // Arrange: as above, and the learner removes every file of the study.
  const { harness, record, studyId, makeCaptureWork } =
    await recordRunWithFailedCapture(context)
  try {
    const afterCaptureFailure = readerState(harness)
    harness.service.records.delete(record.id)
    await removeStudyFilesByHand(harness, studyId)
    makeCaptureWork()

    // Act: the learner presses Retry storage / refresh.
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        afterRetry: readerState(harness),
        listed: (await (await harness.reader.learningStorage()).list()).map(
          (entry) => entry.id,
        ),
      },
      {
        afterCaptureFailure: FAILED_CAPTURE_STATE,
        afterRetry: NO_LINE_STATE,
        listed: [harness.studyId],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane of a study whose capture failed and whose run this window no longer holds, when another window deleted the study with its recording and the learner presses Retry storage / refresh; fails_when=the Retry that finds the study gone from the library keeps the failed receipt of a study without a run here, so the line and Retry stay for a study that is gone; why_new=Cycle 0048 task 129 (state machines: the run-less failed receipt was tested only under another study's save); seam=the capture step ({@link captureStudy}), which fails until the test says otherwise, the service's run list, from which the test drops the run, and a second LearningLibrary over the same storage, which deletes the study with its recording; no_claim=how a run leaves the service, wording of the line, a second editor process
test('the line “History not saved: …” of a study whose capture failed and whose run this window no longer holds goes when another window deleted that study with its recording and Retry storage / refresh was pressed', async (context) => {
  // Arrange: as above, and another window deletes the study with its recording.
  const { harness, record, studyId, makeCaptureWork } =
    await recordRunWithFailedCapture(context)
  try {
    const afterCaptureFailure = readerState(harness)
    harness.service.records.delete(record.id)
    const library = await harness.reader.learningStorage()
    const removal = await new LearningLibrary(
      harness.reader.inspect().libraryDirectory!,
      library.workspaceKey,
    ).removeStudy(studyId, async (path) => {
      await rm(path, { recursive: true })
    })
    makeCaptureWork()

    // Act: the learner presses Retry storage / refresh.
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        afterCaptureFailure,
        removal: { ...removal },
        afterRetry: readerState(harness),
        listed: (await library.list()).map((entry) => entry.id),
      },
      {
        afterCaptureFailure: FAILED_CAPTURE_STATE,
        removal: { outcome: 'moved' },
        afterRetry: NO_LINE_STATE,
        listed: [harness.studyId],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the pane's other storage failure lines (the study list, the refresh) when a study that another window deleted with its recording is forgotten after one of its saves failed here; fails_when=the forget takes the line of a failed save from the pane by clearing the one `archive` line that the list, the refresh and the Node history failures also use, so a list that still cannot be read shows no line and no Retry storage / refresh; why_new=Cycle 0048 task 19 (S11-N15): the History not saved line shared its place with those failures; seam=the reader's error report, which the test calls for a list that cannot be read, the library's save, which fails once, and a second library that deletes the study with its recording; no_claim=the refresh's and the Node history's failure lines, which share that place (the study list's line stands for them), and a deletion by this window
test('a study whose save failed and that another window then deletes with its recording leaves the line of a study list that cannot be read, and no "History not saved: …" line, once its next save is refused', async (context) => {
  // Arrange: a recorded run of this window, stopped and saved; the save of its next checkpoint fails once, and another window then deletes its study, archive and recording.
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const directory = harness.reader.inspect().libraryDirectory!,
      library = await harness.reader.learningStorage()
    const saveStudy = LearningLibrary.prototype.saveStudy
    let hasSaveFailed = false
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        ...input: Parameters<LearningLibrary['saveStudy']>
      ) {
        // Only the first save of the test fails, as a full disk refuses it.
        if (!hasSaveFailed) {
          hasSaveFailed = true
          throw Object.assign(
            new Error('ENOSPC: no space left on device, write'),
            { code: 'ENOSPC' },
          )
        }
        return saveStudy.apply(this, input)
      },
    )
    const explainAndCheckpoint = async (
      key: string,
      interpretation: string,
      endsWhen: (status: string) => boolean,
    ): Promise<void> => {
      await harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: harness.record.id,
        key,
        snapshotUri: harness.service.state(harness.record).participants.browser
          .snapshotUri!,
        sourceHash: sha256('const nextTheme = "dark";\n'),
        valuePaths: ['value:nextTheme'],
        interpretation,
      })
      await readerSeams(harness).refresh()
      await waitUntil(
        () =>
          endsWhen(harness.service.state(harness.record).historyOutcome.status),
        'the end of the checkpoint',
        2_000,
      )
    }
    await explainAndCheckpoint(
      'before-the-deletion',
      'The theme was dark when the run stopped.',
      (status) => status === 'failed',
    )
    const linesAfterTheFailedSave = structuredClone(
      harness.reader.inspect().view!.errors,
    )
    // The study list cannot be read either: the reader tells it in its own line.
    harness.reader['report'](
      'archive',
      new Error('Learning storage could not list the studies.'),
    )
    const removal = await new LearningLibrary(
      directory,
      library.workspaceKey,
    ).removeStudy(harness.studyId, async (path) => {
      await rm(path, { recursive: true })
    })

    // Act: an agent saves another explanation of the stopped run, and the reader takes its checkpoint, whose save the library refuses.
    await explainAndCheckpoint(
      'after-the-deletion',
      'The theme stayed dark after the stop.',
      (status) => status === 'unavailable',
    )

    // Assert
    assert.deepEqual(
      {
        linesAfterTheFailedSave,
        removal: { ...removal },
        linesAfterTheRefusedSave: structuredClone(
          harness.reader.inspect().view!.errors,
        ),
        listed: (await library.list()).map((entry) => entry.id),
      },
      {
        linesAfterTheFailedSave: [
          'Error: History not saved: Error: ENOSPC: no space left on device, write',
        ],
        removal: { outcome: 'moved' },
        linesAfterTheRefusedSave: [
          'Error: Learning storage could not list the studies.',
        ],
        listed: [],
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a recorded run of this window whose first saves cannot look at its recording folder (a permission denied, a disk error, a folder Windows is deleting or a scanner holds): the study stays this window's, the failure is told in the line "History not saved: …", and Retry storage / refresh saves the study once the folder can be looked at again; fails_when=the save counts every failure of that look as the recording having left the library with the study, so the reader forgets the study and drops its pending checkpoint as if another window had deleted it, and the run's learning is never saved although nothing was removed (Cycle 0047 row 170); why_new=Cycle 0047 row 170 (S2CR-2, S2CXA-C2-1, S2OCR2-1, S2CLA-2, S2CXS-1): row 162's test has only a recording folder that is gone; seam=the look at the run's recording folder that the library's study save makes, refused with EACCES while the test says so (every other look reaches the disk)
test('a recorded run whose saves cannot look at its recording folder keeps its study, tells "History not saved: …", and Retry storage / refresh saves the study once the folder can be looked at', async (context) => {
  // Arrange: a recorded run of this window; while it runs and stops, every study save's look at the run's recording folder is refused.
  const harness = await workspaceHarness(true, true)
  try {
    const saveStudy = LearningLibrary.prototype.saveStudy,
      lstatBefore = fsPromises.lstat
    let isLookRefused = true,
      refusedLook: string | undefined
    context.mock.method(
      LearningLibrary.prototype,
      'saveStudy',
      async function (
        this: LearningLibrary,
        ...input: Parameters<LearningLibrary['saveStudy']>
      ) {
        // Only the look this save makes at the run's recording folder is refused.
        refusedLook = isLookRefused ? input[1]?.recordingDirectory : undefined
        try {
          return await saveStudy.apply(this, input)
        } finally {
          refusedLook = undefined
        }
      },
    )
    context.mock.method(
      fsPromises,
      'lstat',
      async (...input: Parameters<typeof lstatBefore>) => {
        if (refusedLook !== undefined && input[0] === refusedLook)
          throw Object.assign(new Error('EACCES: permission denied, lstat'), {
            code: 'EACCES',
          })
        return lstatBefore(...input)
      },
    )
    // A run records only for a build whose source is identified.
    harness.service.environment.build.sourceHash = sha256('recorded-build')
    harness.acknowledgeContext()
    const { record } = await startRun(harness)
    record.recording!.frame({
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        'base64',
      ),
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(100)
    await harness.reader.action('click').catch(() => undefined)
    harness.clock(200)
    const studyId = `${harness.service.instanceId}_${record.id}`,
      library = await harness.reader.learningStorage()

    // Act: the learner stops the run while the look is refused, then presses Retry storage / refresh once the folder can be looked at.
    await harness.reader.action('stop').catch(() => undefined)
    const afterStop = structuredClone({
      isStopped: record.stopped,
      errors: harness.reader.inspect().view!.errors,
      unretryableErrorCount:
        harness.reader.inspect().view!.unretryableErrorCount,
      history: harness.service.state(record).historyOutcome.status,
    })
    isLookRefused = false
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(afterStop, {
      isStopped: true,
      errors: [
        'Error: History not saved: Error: EACCES: permission denied, lstat',
      ],
      // Retry storage / refresh is offered beside the one line.
      unretryableErrorCount: 0,
      history: 'failed',
    })
    assert.deepEqual(
      {
        errors: structuredClone(harness.reader.inspect().view!.errors),
        history: harness.service.state(record).historyOutcome.status,
        listed: (await library.list()).map((entry) => [entry.id, entry.format]),
        isRecordingSealed: (await lookAtRecording(record.recording!.directory))
          .isSealed,
      },
      {
        errors: [],
        history: 'saved',
        listed: [[studyId, 'v3']],
        isRecordingSealed: true,
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

/**
 * Names a run of the reader's workspace that never saved its study, so a test can leave only its recording.
 * @param harness - The reader whose library the run belongs to.
 * @returns The run's study id, its instance and run ids, the workspace key and the profile, as a recording names them.
 * @example const run = await unsavedRunOf(harness)
 */
async function unsavedRunOf(
  harness: Harness,
): Promise<
  Pick<
    Awaited<ReturnType<typeof saveEarlierStudy>>,
    'workspaceKey' | 'id' | 'instanceId' | 'runId' | 'profile'
  >
> {
  const library = await harness.reader.learningStorage()
  const instanceId = randomUUID(),
    runId = randomUUID()
  return {
    workspaceKey: library.workspaceKey,
    id: `${instanceId}_${runId}`,
    instanceId,
    runId,
    profile: 'repository-browser',
  }
}

// Value: protects=a run's recording, with no saved study, that another computer sharing this storage folder wrote, with the record of its writer this build keeps; fails_when=the record of another machine is judged 'may-run', so the recording is hidden from Saved studies for good, or the dialog names this computer from the header (TC3); why_new=Cycle 0046 testing review TC3: the listing test used a header-only recording; seam=the recording's header, which names this host and a process id of no process, its writer record, which names machine-b and old-laptop.local, and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a run’s recording whose writer record names another machine is listed in Saved studies, and Delete moves it after the learner chooses Move to Trash Anyway in a dialog that names the record’s host', async () => {
  // Arrange: only a recording is left of the run; its header names this host, the record of its writer machine-b under old-laptop.local.
  const harness = await workspaceHarness()
  try {
    const run = await unsavedRunOf(harness)
    await unsealedRecordingOf(
      harness,
      run,
      { pid: ID_OF_NO_PROCESS, hostname: hostname() },
      'with-record',
    )
    await rewriteWriterRecord(
      harness.reader.inspect().libraryDirectory!,
      run.id,
      { machineId: 'machine-b', hostname: 'old-laptop.local' },
    )
    await harness.reader.action('retry')
    const listed = harness.reader
      .inspect()
      .view!.studies.map((entry) => [entry.id, entry.format])
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, run.id)

    // Assert
    assert.deepEqual(
      {
        listed: structuredClone(listed),
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves.map((move) => basename(move.path)),
      },
      {
        listed: [[run.id, 'archive-missing']],
        dialogs: [DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST],
        moved: [run.id],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner whose library holds only the recording an editor left when it crashed on this Mac under an earlier host name, or on another computer, for a run that never saved its study; fails_when=such a recording is hidden from Saved studies for good, so its files stay and no Delete reaches the dialog that names its host; why_new=Cycle 0046 review AF2: a study without an archive was listed only when no writer of any host may still write its recording; seam=the recording's header (another host, no record of its writer, as 0.2.29.0 leaves it), and the editor's dialogs and Trash, stubbed at the vscode boundary
test('a run’s crashed recording that names another host is listed in Saved studies, and Delete moves it after the learner chooses Move to Trash Anyway', async () => {
  // Arrange: only a recording is left of the run, made under another host name.
  const harness = await workspaceHarness()
  try {
    const run = await unsavedRunOf(harness)
    await unsealedRecordingOf(
      harness,
      run,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    await harness.reader.action('retry')
    const listed = harness.reader
      .inspect()
      .view!.studies.map((entry) => [entry.id, entry.format])
    harness.answerWarningDialogs(async ([button]) => button)

    // Act
    await requestRemoval(harness, run.id)

    // Assert
    assert.deepEqual(
      {
        listed: structuredClone(listed),
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves.map((move) => basename(move.path)),
        studyRemoval: structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        ),
      },
      {
        listed: [[run.id, 'archive-missing']],
        dialogs: [DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST],
        moved: [run.id],
        studyRemoval: {
          status: 'moved',
          studyId: run.id,
          text: `Saved study moved to the ${TRASH}. The library now holds 0 of 64 saved studies.`,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's Cancel for a listed run's recording that may still run on another computer; fails_when=Cancel moves the recording anyway, or the entry leaves Saved studies; why_new=Cycle 0046 review AF2; seam=the recording's header (another host, no record of its writer), and the editor's dialogs and Trash, stubbed at the vscode boundary
test('Cancel in the dialog about a listed run’s recording that names another host moves nothing, and the entry stays listed', async () => {
  // Arrange: the learner confirms the removal, then cancels the dialog about the recording.
  const harness = await workspaceHarness()
  try {
    const run = await unsavedRunOf(harness)
    const recording = await unsealedRecordingOf(
      harness,
      run,
      { pid: ID_OF_NO_PROCESS, hostname: 'old-laptop.local' },
      'header-only',
    )
    await harness.reader.action('retry')
    harness.answerWarningDialogs(async ([button]) =>
      button === `Move to ${TRASH} Anyway` ? undefined : button,
    )

    // Act
    await requestRemoval(harness, run.id)
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      {
        dialogs: structuredClone(harness.warningDialogs.slice(1)),
        moved: harness.trashMoves,
        listed: structuredClone(
          harness.reader.inspect().view!.studies.map((entry) => entry.id),
        ),
        recordingLeft: await readdir(recording),
      },
      {
        dialogs: [DIALOG_OF_A_RECORDING_ON_ANOTHER_HOST],
        moved: [],
        listed: [run.id],
        recordingLeft: ['frames.jsonl', 'header.json'],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the recording a live run of another window of this machine reserved before it saves its study; fails_when=that reservation is listed as what is left of a removed study, so the learner deletes a recording that is being written; why_new=Cycle 0046 review AF2: a recording of another host is listed now, and one of a live writer of this machine must not be; seam=the recording's header and the record of its writer, which name a live child process of the test with its own start
test('a run’s recording that a live window of this machine still writes is not listed in Saved studies', async (context: TestContext) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const run = await unsavedRunOf(harness)
    const otherWindow = await idleChild(context)
    await unsealedRecordingOf(
      harness,
      run,
      { pid: otherWindow.pid!, hostname: hostname() },
      'with-record',
    )

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.deepEqual(
      structuredClone(
        harness.reader.inspect().view!.studies.map((entry) => entry.id),
      ),
      [],
    )
  } finally {
    await harness.close()
  }
})
