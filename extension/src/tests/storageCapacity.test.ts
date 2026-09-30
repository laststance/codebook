import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
