import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { LearningLibrary } from '../learningLibrary'
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
          detail: `Repository browser study · ${new Date('2026-09-20T00:00:10.000Z').toLocaleString()} · demonstrated · 22222222\n\nAny saved recording for this study moves with it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.`,
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
