import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { NodeHistoryRepository } from '../nodeHistoryRepository'
import { buildServerReplayModel } from '../utils/buildServerReplayModel'

import { SERVER_WORKSPACE_KEY } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const FIXTURE_FOLDER = '../../src/tests/fixtures/node-server-history-v0.2.56.0'
const STUDY_ID =
  '33333333-3333-4333-8333-333333333333_44444444-4444-4444-8444-444444444444'

/**
 * Copies the server history that v0.2.56.0 saved into a fresh learning directory so a test reads it exactly as an upgraded window would.
 * @param context - Supplies the cleanup hook.
 * @returns A repository over the copied learning directory and the folder it holds.
 */
async function openFixtureRepository(context: {
  after: (cleanup: () => Promise<void>) => void
}): Promise<{ repository: NodeHistoryRepository; historyFolder: string }> {
  const learningDirectory = await mkdtemp(join(tmpdir(), 'codebook-fixture-'))
  context.after(() => rm(learningDirectory, { recursive: true, force: true }))
  await cp(
    join(__dirname, FIXTURE_FOLDER, 'node-servers.v1'),
    join(learningDirectory, 'node-servers.v1'),
    { recursive: true },
  )
  return {
    repository: new NodeHistoryRepository(
      learningDirectory,
      SERVER_WORKSPACE_KEY,
      () => 64,
      async () => 0,
    ),
    historyFolder: join(learningDirectory, 'node-servers.v1', STUDY_ID),
  }
}

/** Reads every file of a history folder as name and bytes, so two reads can be compared byte for byte. */
async function folderBytes(folder: string): Promise<Record<string, string>> {
  const names = (await readdir(folder)).sort()
  const entries = await Promise.all(
    names.map(
      async (name) =>
        [
          name,
          (await readFile(join(folder, name))).toString('base64'),
        ] as const,
    ),
  )
  return Object.fromEntries(entries)
}

// protects=a server replay saved by v0.2.56.0 still lists as complete with its title and opens with its verified entries and seal; fails_when=the server descriptor changes its folder, header, entry, seal or order rules;
// no_claim=histories of other versions or of the node-test profile.
test('a server replay saved by v0.2.56.0 lists as complete with its title and opens with its request, stop and response', async (context) => {
  // Arrange
  const { repository } = await openFixtureRepository(context)

  // Act
  const summaries = await repository.serverHistories.list()
  const opened = await repository.serverHistories.read(STUDY_ID)

  // Assert
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0]?.studyId, STUDY_ID)
  assert.equal(summaries[0]?.profile, 'node-server')
  assert.equal(summaries[0]?.status, 'complete')
  assert.equal(summaries[0]?.verification, 'verified')
  assert.equal(summaries[0]?.title, 'Creating an item')
  assert.equal(summaries[0]?.question, 'How does the server create an item?')
  assert.equal(summaries[0]?.requestLine, 'POST /api/items')
  assert.equal(summaries[0]?.responseStatus, 200)
  assert.equal(summaries[0]?.stopCount, 1)
  assert.equal(summaries[0]?.captureComplete, true)
  assert.deepEqual(
    opened.entries.map((entry) => [entry.sequence, entry.type]),
    [
      [1, 'request'],
      [2, 'request-sent'],
      [3, 'source'],
      [4, 'stop'],
      [5, 'output'],
      [6, 'response'],
      [7, 'end'],
    ],
  )
  assert.equal(opened.seal?.status, 'complete')
  assert.equal(
    opened.seal?.journalHash,
    'bd406243a81e83dc08e6f14887ffb290f971d3f196b145a05031d369dfe8deeb',
  )
})

// protects=the replay of a v0.2.56.0 server history rebuilds its events and rehydrates the stop with its executed source and Local scope; fails_when=the stop loses its source text, its scope or the event order;
// no_claim=how the workspace renders the model.
test('the replay model of a v0.2.56.0 server history keeps the stop with its source text and Local scope', async (context) => {
  // Arrange
  const { repository } = await openFixtureRepository(context)

  // Act
  const model = buildServerReplayModel(
    await repository.serverHistories.read(STUDY_ID),
    { saved: true, captureComplete: true, learningCoverage: 'complete' },
  )

  // Assert
  assert.deepEqual(
    model.events.map((event) => [event.sequence, event.type]),
    [
      [1, 'request'],
      [4, 'stop'],
      [5, 'output'],
      [6, 'response'],
    ],
  )
  const stopEvent = model.events[1]
  assert.equal(stopEvent?.type, 'stop')
  const frame =
    stopEvent?.type === 'stop'
      ? stopEvent.debuggerSnapshot.frames[0]
      : undefined
  assert.equal(frame?.name, 'handler')
  assert.equal(frame?.scopes[0]?.name, 'Local')
  assert.match(frame?.source?.text ?? '', /export function handler\(req\)/)
})

// protects=the learning material saved by v0.2.56.0 still reads with its revision and its citations against the journal; fails_when=the material schema or the citation check rejects the saved file;
// no_claim=saving a new revision.
test('the learning material saved by v0.2.56.0 reads at revision 1 with its four cited steps', async (context) => {
  // Arrange
  const { repository } = await openFixtureRepository(context)

  // Act
  const material =
    await repository.serverHistories.readLearningMaterial(STUDY_ID)

  // Assert
  assert.equal(material?.revision, 1)
  assert.equal(material?.content.title, 'Creating an item')
  assert.deepEqual(
    material?.content.steps.map((step) => step.reference?.type),
    ['request', 'stop', 'output', 'response'],
  )
})

// protects=listing, opening and reading the material of a saved history write nothing to it; fails_when=a read or a list rewrites, repairs or adds a file of the v0.2.56.0 folder;
// no_claim=the writer's own files while a run is live.
test('listing and opening a v0.2.56.0 server history leave every file of its folder byte for byte unchanged', async (context) => {
  // Arrange
  const { repository, historyFolder } = await openFixtureRepository(context)
  const before = await folderBytes(historyFolder)

  // Act
  await repository.serverHistories.list()
  await repository.serverHistories.read(STUDY_ID)
  await repository.serverHistories.readLearningMaterial(STUDY_ID)
  const after = await folderBytes(historyFolder)

  // Assert
  assert.deepEqual(Object.keys(after), [
    'events.jsonl',
    'header.json',
    'learning-material.json',
    'sealed.json',
  ])
  assert.deepEqual(after, before)
})
