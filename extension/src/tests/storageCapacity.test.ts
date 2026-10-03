import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

/** Creates distinct sealed identities for capacity admission tests without running an application. @example const { study, binding } = capacityStudy() */
function capacityStudy() {
  const study = createConfiguredStudy(),
    runId = randomUUID()
  for (const observation of study.observations)
    observation.snapshotUri = observation.snapshotUri.replace(
      study.runId,
      runId,
    )
  study.runId = runId
  study.id = `${study.instanceId}_${runId}`
  const binding = {
    workspaceKey: study.workspaceKey,
    studyId: study.id,
    instanceId: study.instanceId,
    runId,
    runtimeId: randomUUID(),
    profile: study.profile,
    sourceBuild: {
      revision: 'capacity-test',
      dirty: false,
      sourceHash: '1'.repeat(64),
    },
  }
  return { study, binding }
}

test('a seventeenth saved study and recording remain discoverable after restart without evicting the first sixteen', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const first = capacityStudy(),
    library = new LearningLibrary(directory, first.study.workspaceKey),
    recordings = new RecordingStore(directory, first.study.workspaceKey)
  await library.saveStudy(first.study)
  await (await recordings.start(first.binding, 0)).finish(1)
  const original = await readFile(
    join(directory, `${first.study.id}.study.v3.json`),
  )
  // Act
  for (let index = 0; index < 16; index++) {
    const { study, binding } = capacityStudy()
    await library.saveStudy(study)
    await (await recordings.start(binding, 0)).finish(1)
  }
  // Assert
  assert.equal(
    (await new LearningLibrary(directory, first.study.workspaceKey).list())
      .length,
    17,
  )
  assert.equal(
    (await new RecordingStore(directory, first.study.workspaceKey).list())
      .length,
    17,
  )
  assert.deepEqual(
    await readFile(join(directory, `${first.study.id}.study.v3.json`)),
    original,
  )
  assert.deepEqual(await library.readStudy(first.study.id), first.study)
})

// Value: protects=the disclosed limit of the start check: it reserves no place; fails_when=the README's statement no longer holds (the second window's save is silently kept past the limit, or its refusal loses the retry-storage wording); why_new=Cycle 0037 PR2 (the race was known and not disclosed or pinned); seam=two stores over one library directory stand for two editor windows
test('two windows admitted for the last free place both start, and the study saved second is refused at its save with the retry-storage message', async (context) => {
  // Arrange: a limit of two with one study saved; each window asks before either has saved.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-race-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const saved = capacityStudy(),
    firstWindow = capacityStudy(),
    secondWindow = capacityStudy(),
    workspaceKey = saved.study.workspaceKey
  const library = new LearningLibrary(directory, workspaceKey, () => 2)
  await library.saveStudy(saved.study)
  const firstStore = new RecordingStore(
      directory,
      workspaceKey,
      {},
      undefined,
      () => 2,
    ),
    secondStore = new RecordingStore(
      directory,
      workspaceKey,
      {},
      undefined,
      () => 2,
    )

  // Act
  const firstAdmitted = await firstStore.admitsStudy(firstWindow.study.id),
    secondAdmitted = await secondStore.admitsStudy(secondWindow.study.id)
  await library.saveStudy(firstWindow.study)
  const secondSave = await new LearningLibrary(directory, workspaceKey, () => 2)
    .saveStudy(secondWindow.study)
    .then(
      () => 'saved',
      (error: unknown) => String(error),
    )

  // Assert
  assert.equal(firstAdmitted, true)
  assert.equal(secondAdmitted, true)
  assert.equal(
    secondSave,
    'Error: Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.',
  )
  assert.equal((await library.list()).length, 2)
})

test('raising the setting recovers both full stores and lowering it keeps prior checkpoints and recordings readable', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-change-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  let capacity: unknown = 1
  const first = capacityStudy(),
    second = capacityStudy()
  const library = new LearningLibrary(
    directory,
    first.study.workspaceKey,
    () => capacity,
  )
  const recordings = new RecordingStore(
    directory,
    first.study.workspaceKey,
    {},
    undefined,
    () => capacity,
  )
  await library.saveStudy(first.study)
  await (await recordings.start(first.binding, 0)).finish(1)
  await writeFile(
    join(directory, 'untouched-progress'),
    'explicit learner choices',
  )
  await assert.rejects(
    library.saveStudy(second.study),
    /codebook.savedStudyLimit/,
  )
  await assert.rejects(
    recordings.start(second.binding, 0),
    /codebook.savedStudyLimit/,
  )
  // Act
  capacity = 2
  assert.equal(recordings.capacityStatus().limit, 2)
  await library.saveStudy(second.study)
  await (await recordings.start(second.binding, 0)).finish(1)
  capacity = 1
  await library.saveStudy({
    ...first.study,
    savedAt: '2026-09-20T00:00:20.000Z',
  })
  // Assert
  assert.equal((await library.list()).length, 2)
  assert.equal((await recordings.list()).length, 2)
  assert.equal(
    (await library.readStudy(first.study.id)).savedAt,
    '2026-09-20T00:00:20.000Z',
  )
  assert.equal(
    (await recordings.read(second.study.id)).header.studyId,
    second.study.id,
  )
  assert.equal(
    await readFile(join(directory, 'untouched-progress'), 'utf8'),
    'explicit learner choices',
  )
  const third = capacityStudy()
  await assert.rejects(library.saveStudy(third.study), /full/)
  await assert.rejects(recordings.start(third.binding, 0), /full/)
  // Invalid configuration affects new admission only, including after a successful session.
  for (capacity of [
    0,
    -1,
    1.5,
    257,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '64',
    null,
  ]) {
    assert.equal(recordings.capacityStatus().limit, undefined)
    assert.match(recordings.capacityStatus().error!, /integer from 1 to 256/)
    await assert.rejects(
      library.saveStudy(third.study),
      /integer from 1 to 256/,
    )
    await assert.rejects(
      recordings.start(third.binding, 0),
      /integer from 1 to 256/,
    )
    await library.saveStudy({
      ...first.study,
      savedAt: '2026-09-20T00:00:20.000Z',
    })
    assert.equal((await library.list()).length, 2)
    assert.equal((await recordings.list()).length, 2)
  }
})

test('two editor windows cannot admit two new studies into the last configured slot', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-race-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const first = capacityStudy(),
    second = capacityStudy()
  const left = new LearningLibrary(directory, first.study.workspaceKey, () => 1)
  const right = new LearningLibrary(
    directory,
    first.study.workspaceKey,
    () => 1,
  )
  // Act
  const results = await Promise.allSettled([
    left.saveStudy(first.study),
    right.saveStudy(second.study),
  ])
  // Assert
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  )
  assert.equal((await left.list()).length, 1)
})

test('a full study library tells before a run that it can keep a study it already holds and no new one', async (context) => {
  // Arrange: one saved study under a limit of one.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-admit-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  let capacity: unknown = 1
  const first = capacityStudy(),
    second = capacityStudy()
  const library = new LearningLibrary(
      directory,
      first.study.workspaceKey,
      () => capacity,
    ),
    recordings = new RecordingStore(
      directory,
      first.study.workspaceKey,
      {},
      undefined,
      () => capacity,
    )
  await library.saveStudy(first.study)
  // Act
  const admitsKeptStudy = await library.admitsStudy(first.study.id),
    admitsNewStudy = await library.admitsStudy(second.study.id),
    storeAdmitsNewStudy = await recordings.admitsStudy(second.study.id)
  capacity = 2
  const admitsNewStudyBelowLimit = await recordings.admitsStudy(second.study.id)
  // Assert
  assert.equal(admitsKeptStudy, true)
  assert.equal(admitsNewStudy, false)
  assert.equal(storeAdmitsNewStudy, false)
  assert.equal(admitsNewStudyBelowLimit, true)
  // Asking reserved nothing: no recording exists and the library still holds its one study.
  assert.equal((await recordings.list()).length, 0)
  assert.equal((await library.list()).length, 1)
})

// Value: protects=a run is admitted or refused while another window is writing the library; fails_when=the admission takes the storage lock, so a run that starts during another window's save fails with the lock error instead of its answer; why_new=Cycle 0044 0037-D8: every admission test asked while the lock was free; seam=none
test('the run admission answers while another window holds the storage lock', async (context) => {
  // Arrange: one saved study under a limit of one, and the writer lock of a running editor process in the library directory.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-locked-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const first = capacityStudy(),
    second = capacityStudy()
  const library = new LearningLibrary(
      directory,
      first.study.workspaceKey,
      () => 1,
    ),
    recordings = new RecordingStore(
      directory,
      first.study.workspaceKey,
      {},
      undefined,
      () => 1,
    )
  await library.saveStudy(first.study)
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: process.pid, hostname: hostname() }),
  )
  // Act
  const admitsKeptStudy = await library.admitsStudy(first.study.id),
    admitsNewStudy = await recordings.admitsStudy(second.study.id)
  // Assert
  assert.equal(admitsKeptStudy, true)
  assert.equal(admitsNewStudy, false)
  // The lock was real: a save is refused while it is held.
  await assert.rejects(library.saveStudy(second.study), {
    message:
      'Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
  })
})

test('saving a new study into a full library still reports the limit setting and keeps the saved study', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-capacity-save-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const first = capacityStudy(),
    second = capacityStudy()
  const library = new LearningLibrary(
    directory,
    first.study.workspaceKey,
    () => 1,
  )
  await library.saveStudy(first.study)
  // Act / Assert
  await assert.rejects(library.saveStudy(second.study), {
    message:
      'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.',
  })
  assert.deepEqual(await library.readStudy(first.study.id), first.study)
})
