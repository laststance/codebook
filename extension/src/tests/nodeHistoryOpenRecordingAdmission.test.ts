import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  nodeServerHistoryHeader,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** One window wired as the workspace wires it: the repository counts through a counting library, the recordings count the repository's histories. */
async function openWindow(context: TestContext, limit: number) {
  const study = createConfiguredStudy()
  const counterOf = (directory: string) =>
    new LearningLibrary(directory, study.workspaceKey, () => limit)
  let counter: LearningLibrary | undefined
  const opened = await openServerRepository(context, {
    limit,
    workspaceKey: study.workspaceKey,
    savedStudies: () => counter!.takenStudyCount(),
  })
  counter = counterOf(opened.learningDirectory)
  const recordings = new RecordingStore(
    opened.learningDirectory,
    study.workspaceKey,
    {},
    undefined,
    () => limit,
    () => 'available',
    (places) => opened.repository.countHistories(places),
  )
  const binding = () => {
    const runId = randomUUID()
    return {
      workspaceKey: study.workspaceKey,
      studyId: `${study.instanceId}_${runId}`,
      instanceId: study.instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'open-recording-admission',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    }
  }
  return { ...opened, recordings, binding, study }
}

// protects=a history start counts a recording that is open and not archived yet, so the recording can always archive; fails_when=a server or test history takes the place an open recording started with; no_claim=the wording of the refusal
for (const kind of ['server', 'test'] as const) {
  test(`with one place and an open recording, a ${kind} history start is refused`, async (context) => {
    // Arrange
    const window = await openWindow(context, 1)
    await window.recordings.start(window.binding(), 0)
    const workspaceKey = window.study.workspaceKey

    // Act
    const start =
      kind === 'server'
        ? window.repository.serverHistories.start(
            nodeServerHistoryHeader(workspaceKey),
          )
        : window.repository.testHistories.start(
            nodeTestHistoryHeader(workspaceKey),
          )

    // Assert
    await assert.rejects(start, /full|limit/i)
  })
}

// protects=a recording and a history racing for the last place give exactly one success in both orders; fails_when=both start, or the recording that won cannot archive; no_claim=two windows (one storage lock covers both)
for (const order of ['recording first', 'history first'] as const) {
  test(`with one place, a recording start and a server history start asked at once give one success (${order})`, async (context) => {
    // Arrange
    const window = await openWindow(context, 1)
    const startRecording = () => window.recordings.start(window.binding(), 0)
    const startHistory = () =>
      window.repository.serverHistories.start(
        nodeServerHistoryHeader(window.study.workspaceKey),
      )

    // Act
    const results = await Promise.allSettled(
      order === 'recording first'
        ? [startRecording(), startHistory()]
        : [startHistory(), startRecording()],
    )

    // Assert
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    assert.equal(
      results.filter((result) => result.status === 'rejected').length,
      1,
    )
  })
}

// protects=an open recording does not take a second place when it archives; fails_when=the count adds the archive to the recording of the same study; no_claim=the library's own save rules
test('an archived study with its recording takes one place of the limit', async (context) => {
  // Arrange
  const window = await openWindow(context, 2)
  const library = new LearningLibrary(
    window.learningDirectory,
    window.study.workspaceKey,
    () => 2,
  )
  await (
    await window.recordings.start(
      {
        ...window.binding(),
        studyId: window.study.id,
        runId: window.study.runId,
      },
      0,
    )
  ).finish(1)
  await library.saveStudy(window.study)

  // Act
  const taken = await library.takenStudyCount()

  // Assert
  assert.equal(taken, 1)
})
