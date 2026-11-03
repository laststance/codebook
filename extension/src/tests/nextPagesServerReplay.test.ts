import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mock, test } from 'node:test'

import type { RetainedStudy } from '../retainedStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { capturePagesServerStudy } from './utils/capturePagesServerStudy'
import {
  replaySavedServerStop,
  type ReplayedStop,
} from './utils/replaySavedServerStop'

/** The study file 0.2.74.0's harness saved for the run of {@link capturePagesServerStudy}: a Pages run whose `getServerSideProps` stop paused at the entry load with `count` 3. */
const SAVED_STUDY_PATH = resolve(
  __dirname,
  '../../src/tests/fixtures/pages-server-study-v0.2.74.0/pages-server-entry-load.study.v8.json',
)

/** Says what the replay of a Pages server stop must show, whichever file the study came from. @example expectPagesServerStopShown(replayed) */
function expectPagesServerStopShown(replayed: ReplayedStop): void {
  const recorded = replayed.study.observations.find(
    (observation) => observation.participant === 'server',
  )
  assert.equal(replayed.study.version, 8)
  assert.equal(recorded?.execution, 'server-render')
  assert.equal(recorded?.attribution, 'entry-load')
  assert.equal(replayed.observationId, recorded?.id)
  // The recorded frame's top stack frame and its count.
  assert.equal(replayed.topFrameName, 'getServerSideProps')
  assert.equal(replayed.topFrameLine, 6)
  assert.deepEqual(replayed.variables, [{ name: 'count', value: '3' }])
  // The source shown is the version that ran: its text hashes to the recorded hash, which the observation sealed.
  assert.equal(replayed.shownSourceHash, recorded?.source.hash)
  assert.equal(sha256(replayed.shownSourceText ?? ''), recorded?.source.hash)
}

// Value: protects=AC 5 a saved Pages server run reopens from the library and replays: the recorded frame's count (3) and its top stack frame (getServerSideProps) appear in the replay debug session at the recorded moment, the source shown is the hashed version that ran, the study is saved as format 8 with the unchanged validator, and replaying starts no server and sends no request; fails_when=the saved study is refused on reopening, the replay shows another frame or value, shows source text that does not hash to the recorded hash, or the replay spawns a process or sends a request; no_claim=the Study pane's presentation (workspace tests), a real js-debug (the adapter is driven by protocol messages), and the playback timeline of a recording (a recording index with no frames stands in)
test('a saved Pages server run reopens from the library and replays its count and top frame with no server and no request', async (context) => {
  // Arrange
  const study = await capturePagesServerStudy(context)
  const fetchCalls = mock.method(globalThis, 'fetch', () => {
    throw new Error('A replay sends no request.')
  })
  const spawnCalls = mock.method(childProcess, 'spawn', () => {
    throw new Error('A replay starts no server.')
  })
  context.after(() => {
    fetchCalls.mock.restore()
    spawnCalls.mock.restore()
  })
  // Act
  const replayed = await replaySavedServerStop(context, study)
  // Assert
  expectPagesServerStopShown(replayed)
  assert.equal(fetchCalls.mock.callCount(), 0)
  assert.equal(spawnCalls.mock.callCount(), 0)
})

// Value: protects=AC 5 rollback: a study file saved by this change's harness (format 8, no new field) opens and replays through the replay path that 0.2.73.2 has, whose study validator and schema are unchanged, with the recorded count (3), the top frame getServerSideProps and the hashed source; fails_when=the committed file stops validating, its server pause loses a field the reader needs, or the replay shows another frame or value; no_claim=the 0.2.73.2 binary (the current reader stands in; pt2 changes neither configuredStudySchemas.ts nor the validator, which the PR's diff shows), and a file written by a real Next run
test('a Pages server study file saved by this change opens and replays through the unchanged replay path', async (context) => {
  // Arrange
  const saved: RetainedStudy = JSON.parse(
    await readFile(SAVED_STUDY_PATH, 'utf8'),
  )
  // Act
  const replayed = await replaySavedServerStop(context, saved)
  // Assert
  expectPagesServerStopShown(replayed)
  assert.equal(JSON.stringify(saved).includes('/Users/'), false)
})
