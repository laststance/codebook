import assert from 'node:assert/strict'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { sha256 } from '../runtimeSupport/utils/sha256'

const FIXTURE_FOLDER = '../../src/tests/fixtures/node-test-history-v0.2.53.0'
const STUDY_ID =
  '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222'

/**
 * Copies the history that v0.2.53.0 saved into a fresh learning directory so a test reads it exactly as an upgraded window would.
 * @param context - Supplies the cleanup hook.
 * @returns A store over the copied learning directory.
 */
async function openFixtureStore(context: {
  after: (cleanup: () => Promise<void>) => void
}): Promise<NodeTestHistoryStore> {
  const learningDirectory = await mkdtemp(join(tmpdir(), 'codebook-fixture-'))
  context.after(() => rm(learningDirectory, { recursive: true, force: true }))
  await cp(
    join(__dirname, FIXTURE_FOLDER, 'node-tests.v1'),
    join(learningDirectory, 'node-tests.v1'),
    { recursive: true },
  )
  return new NodeTestHistoryStore(
    learningDirectory,
    sha256('node-history-test-workspace'),
  )
}

// protects=a test replay saved before the storage generalization still lists and opens after an upgrade;
// fails_when=the node-test descriptor changes its folder, header, entry, seal or order rules;
// no_claim=histories of other versions or of the node-server profile.
test('a test replay saved by v0.2.53.0 lists as complete with its stops and opens with all five entries', async (context) => {
  // Arrange
  const store = await openFixtureStore(context)

  // Act
  const summaries = await store.list()
  const opened = await store.read(STUDY_ID)

  // Assert
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0]?.studyId, STUDY_ID)
  assert.equal(summaries[0]?.profile, 'node-test')
  assert.equal(summaries[0]?.status, 'complete')
  assert.equal(summaries[0]?.stopCount, 2)
  assert.equal(summaries[0]?.testResult, 'passed')
  assert.deepEqual(
    opened.entries.map((entry) => entry.type),
    ['output', 'stop', 'output', 'stop', 'result'],
  )
  assert.equal(opened.seal?.status, 'complete')
})
