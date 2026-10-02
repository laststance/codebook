import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { RecordingStore } from '../recordingStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  recordedReaderHarness,
  saveOneStopNodeHistory,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

const FULL_LIBRARY_REFUSAL =
  'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Existing learning was kept.'

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

/** Sends the Saved studies section's delete request for one entry, as the Study pane does. @example await requestRemoval(harness, study.id) */
function requestRemoval(harness: Harness, studyId: string): Promise<void> {
  return harness.reader['receive'](
    {
      type: 'delete-study',
      revision: harness.reader.inspect().view!.revision,
      studyId,
    },
    'context',
  )
}

/** Chooses one entry of Saved studies, as the Study pane's list does, and waits until the reader shows it. @example await chooseStudy(harness, study.id) */
async function chooseStudy(harness: Harness, studyId: string): Promise<void> {
  // The list only exists in an open Study pane, and a closed reader never finishes loading a chosen study.
  await harness.reader.open()
  await harness.reader['receive'](
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

/** Sends the Saved studies list's choice of one entry without waiting for the reader to show it, as a learner does who acts again at once. @example const opening = sendChoice(harness, 'history', study.id) */
function sendChoice(
  harness: Harness,
  type: 'history' | 'node-history',
  studyId: string,
): Promise<void> {
  return harness.reader['receive'](
    { type, revision: harness.reader.inspect().view!.revision, studyId },
    'context',
  )
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
      await harness.reader['refresh']()
    // Assert
    assert.equal(record.error?.message, FULL_LIBRARY_REFUSAL)
    assert.equal(studySaves, 0)
    assert.equal(harness.reader['pendingArchives'].size, 0)
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
      await harness.reader['refresh']()
    const savesWhileHeld = studySaves,
      queuedWhileHeld = harness.reader['pendingArchives'].size
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
    await harness.reader['refresh']()
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
        title: 'Move this saved study to the Trash?',
        options: {
          modal: true,
          detail: `Repository browser study · ${new Date('2026-09-20T00:00:10.000Z').toLocaleString()} · demonstrated · 22222222\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.`,
        },
        items: ['Move to Trash'],
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
      await harness.reader['refresh']()
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
      text: 'Saved study moved to the Trash. The library now holds 2 of 64 saved studies.',
    })
    assert.deepEqual(structuredClone(afterRefreshes.studyRemoval), {
      status: 'moved',
      studyId: middle.id,
      text: 'Saved study moved to the Trash. The library now holds 2 of 64 saved studies.',
    })
    assert.equal(afterAnotherChoice.studyRemoval, undefined)
    assert.equal(
      afterRemoval.errors.some((line) => line.includes('Trash')),
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
      text: 'Saved study moved to the Trash. The library now holds 0 of 64 saved studies.',
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
    await harness.reader['refresh']()
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
      await harness.reader['refresh']()
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
      'The learner moved this saved study to the Trash.',
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
    await harness.reader['refresh']()
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
    await harness.reader['receive'](
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
    confirm('Move to Trash')
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

// Value: protects=a study whose files are being moved can be neither opened nor played, and the pane says that the move is in progress; fails_when=a reader or an agent opens a half-moved study; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('while a saved study is being moved to the Trash it cannot be opened or played and the pane says it is moving', async () => {
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
    const openedHistory = harness.reader['readSavedArchive'](study.id).then(
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
      text: 'Moving the saved study to the Trash…',
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
      text: 'Moving the saved study to the Trash…',
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
      text: 'Saved study moved to the Trash. The library now holds 1 of 64 saved studies.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=a removal that fails before anything moved changes nothing: the run stays saved and keeps being saved; fails_when=the run is excluded from history although its study still exists; why_new=no removal existed; seam=the editor's dialog and Trash, stubbed at the vscode boundary
test('a removal the Trash refuses at its first move deletes nothing, and a later explanation of that run is still saved', async () => {
  // Arrange: a recorded, stopped and saved run; the Trash refuses every move.
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.rejectTrashMoves(() => true)
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
    await harness.reader['refresh']()
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
      text: `The saved study could not be moved to the Trash. Nothing was deleted. Trash refused ${harness.studyId}`,
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
    const lock = join(harness.reader.inspect().libraryDirectory!, 'writer.lock')
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
        text: 'The saved study could not be moved to the Trash. Nothing was deleted. Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
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
        text: 'Saved study moved to the Trash. The library now holds 0 of 64 saved studies.',
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
      text: `The saved study was only partly moved to the Trash; delete it again to finish. Trash refused ${shown.id}.study.v3.json`,
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
        confirm?.('Move to Trash')
        confirm = undefined
      }
      return view()
    }
    // Act: a forced checkpoint, as Retry storage and retirement make it.
    capturing = true
    await harness.reader['checkpoint'](harness.service, harness.record, true)
    capturing = false
    await removal
    await harness.reader['refresh']()
    // Assert
    assert.equal(harness.reader.inspect().view!.studyRemoval?.status, 'moved')
    assert.deepEqual(await library.list(), [])
    assert.deepEqual(
      (await readdir(directory)).filter((name) =>
        name.includes(harness.studyId),
      ),
      [],
    )
    assert.equal(harness.reader['pendingArchives'].size, 0)
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
    await harness.reader['refresh']()
    await waitUntil(() => studySaves === 1, 'the held study save', 2_000)
    await explain('waiting-checkpoint', 'The second later explanation.')
    await harness.reader['refresh']()
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
    assert.equal(harness.reader['pendingArchives'].size, 0)
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
    context.mock.method(
      RecordingStore.prototype,
      'savePreference',
      async function (
        this: RecordingStore,
        preference: Parameters<RecordingStore['savePreference']>[0],
      ) {
        // A slow save is still outside the storage lock when the removal is requested; only a removal that waits for it lets it land first.
        await new Promise((resolve) => setTimeout(resolve, 50))
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
    await harness.reader['receive'](
      {
        type: 'tab',
        revision: harness.reader.inspect().view!.revision,
        tab: 'overview',
      },
      'context',
    )
    // Act
    await requestRemoval(harness, harness.studyId)
    const savesBeforeLaterSave = order.filter(
      (step) => step === 'position saved',
    ).length
    await harness.controller['dependencies'].save({
      ...harness.controller.bundle()!,
      studyId: harness.studyId,
    })
    // Assert
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
      text: 'Saved study moved to the Trash. The library now holds 0 of 1 saved studies. Ask your editor agent to start the run again.',
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
      'Saved study moved to the Trash. The library now holds 1 of 1 saved studies.',
    )
    assert.equal(
      stillFull.runRefusal,
      `The last run did not start: ${FULL_LIBRARY_REFUSAL}`,
    )
    assert.equal(
      stillInvalid.studyRemoval?.text,
      'Saved study moved to the Trash.',
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
    await harness.reader['refresh']()
    await waitUntil(() => studySaves === 1, 'the held study save', 2_000)
    await explain('waiting-checkpoint', 'The second later explanation.')
    await harness.reader['refresh']()
    harness.answerWarningDialogs(async ([confirm]) => confirm)
    harness.rejectTrashMoves(() => true)
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
      () => harness.reader['pendingArchives'].size === 0,
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
    assert.equal(harness.reader['pendingArchives'].size, 0)
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
    harness.rejectTrashMoves(() => true)
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
    await harness.reader['refresh']()
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
      text: `The saved study could not be moved to the Trash. Nothing was deleted. Trash refused ${harness.studyId}.study.meta.v3.json`,
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
test('a delete request while a chosen Node test history is still opening is refused with the same sentence', async (context) => {
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

// Value: protects=a study whose recording is on its way to the screen is never moved underneath it; fails_when=the refusal looks only at a Recording that is already active, so a delete right after pressing Recording moves the files the load is reading; why_new=the Recording refusal was only tested once the recording had opened; seam=the reader's replay-debugger preparation, held by the test
test('a removal is refused while a recording is still opening, also when the open is accepted while the confirmation is waiting', async () => {
  // Arrange: a saved recorded run; the load of its recording is held before Recording becomes active.
  const harness = await recordedReaderHarness()
  try {
    const prepareDebugger = harness.reader[
      'replaceUnavailableReplayDebugger'
    ].bind(harness.reader)
    let releaseLoad = (): void => {}
    const holdNextLoad = (): void => {
      const held = new Promise<void>((resolve) => {
        releaseLoad = resolve
      })
      harness.reader['replaceUnavailableReplayDebugger'] = async (
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
    const activeWhileOpening = harness.reader['recordingActive'],
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
    await harness.reader['receive'](
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
    const activeWhileConfirming = harness.reader['recordingActive']
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

// Value: protects=a recording that failed to open before Recording became active does not lock its study against deletion; fails_when=the refusal remembers the failed open instead of reading the controller, so the study can never be removed in that window; why_new=the refusal now also covers an open in flight and must end with it; seam=the reader's replay-debugger preparation, made to fail by the test
test('after a recording open failed before Recording became active, the study can be removed', async () => {
  // Arrange: a saved recorded run whose recording load fails at its first step.
  const harness = await recordedReaderHarness()
  try {
    harness.reader['replaceUnavailableReplayDebugger'] =
      async (): Promise<void> => {
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
    assert.equal(harness.reader['recordingActive'], false)
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
    await harness.reader['receive'](
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
      text: 'Saved study moved to the Trash. The library now holds 2 of 64 saved studies.',
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
    const liveWhileRunning = harness.reader['liveComposition']
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
    assert.equal(harness.reader['liveComposition'], false)
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
    const liveArrangementBeforeRemoval = harness.reader['liveComposition']
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
        text: 'Saved study moved to the Trash. The library now holds 1 of 64 saved studies.',
      },
    )
    assert.equal(
      (await library.readProgress()).selection?.studyId,
      neighbour.id,
    )
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
        text: 'Saved study moved to the Trash. The library now holds 0 of 64 saved studies.',
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
      "Saved study moved to the Trash. The library now holds 0 of 64 saved studies. The run's raw evidence was left in place because its Codebook window may still be open.",
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
      'Saved study moved to the Trash. The library now holds 0 of 64 saved studies.',
    )
    assert.throws(
      () => harness.service.assertEvidenceAvailable(harness.record),
      /The learner moved this saved study to the Trash\./,
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
