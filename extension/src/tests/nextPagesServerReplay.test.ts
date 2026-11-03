import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mock, test, type TestContext } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import type { ConfiguredStudy } from '../configuredStudySchemas'
import { LearningLibrary } from '../learningLibrary'
import { ReplayDebugAdapter } from '../replayDebugAdapter'
import type { RetainedStudy } from '../retainedStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy'
import { projectRecording } from '../utils/projectRecording'
import { validateRecordingContext } from '../utils/validateRecordingContext'

import { capturePagesServerStudy } from './utils/capturePagesServerStudy'

/** The study file 0.2.74.0's harness saved for the run of {@link capturePagesServerStudy}: a Pages run whose `getServerSideProps` stop paused at the entry load with `count` 3. */
const SAVED_STUDY_PATH = resolve(
  __dirname,
  '../../src/tests/fixtures/pages-server-study-v0.2.74.0/pages-server-entry-load.study.v8.json',
)

/** What the learner sees of the recorded server stop in the replay debug session. */
interface ReplayedStop {
  study: ConfiguredStudy
  observationId: string | undefined
  topFrameName: string | undefined
  topFrameLine: number | undefined
  variables: { name: string; value: string }[]
  shownSourceHash: string | undefined
  shownSourceText: string | undefined
}

/**
 * Saves a study in a library folder, reopens it from there and replays its server stop in the replay debug session at the moment it was recorded.
 *
 * Why it exists: the replay of a saved study reads the library, projects the recording at a moment and gives the observation's debugger state to the replay debug adapter; both tests of a saved Pages server run walk that path unchanged. The test replay starts nothing and sends nothing: it reads files and drives the adapter.
 * @param context - The test, which removes the library folder.
 * @param study - The study to save and replay.
 * @returns The reopened study and what the replay debug session shows at the server stop.
 * @example const replayed = await replaySavedServerStop(context, study)
 */
async function replaySavedServerStop(
  context: TestContext,
  study: RetainedStudy,
): Promise<ReplayedStop> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-pages-replay-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, study.workspaceKey)
  await library.saveStudy(study)
  const reopened = await library.readStudy(study.id)
  const decoded = decodeConfiguredStudy(reopened, reopened.workspaceKey)
  const recorded = decoded.observations.find(
    (observation) => observation.participant === 'server',
  )
  const recordingContext = validateRecordingContext(
    buildRecordingContext(decoded, [], 1),
    decoded.workspaceKey,
  )
  const projection = projectRecording(
    {
      header: {
        version: 3,
        workspaceKey: decoded.workspaceKey,
        studyId: decoded.id,
        instanceId: decoded.instanceId,
        runId: decoded.runId,
        runtimeId: decoded.runId,
        profile: decoded.profile,
        sourceBuild: {
          revision: 'test',
          dirty: false,
          sourceHash: sha256('test source'),
        },
        createdAt: decoded.createdAt,
        startedMs: 0,
        clock: 'runtime-receipt-ms',
        sampleIntervalMs: 50,
        owner: { pid: 1, hostname: 'test', sessionId: decoded.instanceId },
      },
      entries: [],
      status: 'finalized',
      endMs: (recorded?.elapsedMs ?? 0) + 1_000,
      lastVerifiedMs: (recorded?.elapsedMs ?? 0) + 1_000,
    },
    recordingContext,
    recorded?.elapsedMs ?? 0,
  )
  const messages: (DebugProtocol.Response | DebugProtocol.Event)[] = []
  const adapter = new ReplayDebugAdapter(
    (message) => messages.push(message),
    () => {},
    () => {},
  )
  let sequence = 0
  const request = (command: string, arguments_?: unknown) => {
    const requestSequence = ++sequence
    adapter.handleMessage({
      seq: requestSequence,
      type: 'request',
      command,
      arguments: arguments_,
    })
    const response = messages.find(
      (message) =>
        'request_seq' in message && message.request_seq === requestSequence,
    )
    assert.ok(response && 'request_seq' in response)
    return response
  }
  assert.ok(projection.debugger, 'the recorded moment has debugger state')
  adapter.select(projection.debugger, 'Recorded')
  request('configurationDone')
  const topFrame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: topFrame.id }).body.scopes[0]
  const variables: { name: string; value: string }[] = request('variables', {
    variablesReference: scope.variablesReference,
  }).body.variables
  return {
    study: reopened,
    observationId: projection.observation?.id,
    topFrameName: topFrame.name,
    topFrameLine: topFrame.line,
    variables: variables.map(({ name, value }) => ({ name, value })),
    shownSourceHash: projection.debugger.frames[0]?.source?.hash,
    shownSourceText: projection.debugger.frames[0]?.source?.text,
  }
}

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
