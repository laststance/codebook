import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import type { ConfiguredStudy } from '../../configuredStudySchemas'
import { LearningLibrary } from '../../learningLibrary'
import { ReplayDebugAdapter } from '../../replayDebugAdapter'
import type { RetainedStudy } from '../../retainedStudySchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../../utils/buildRecordingContext'
import { decodeConfiguredStudy } from '../../utils/decodeConfiguredStudy'
import { projectRecording } from '../../utils/projectRecording'
import { validateRecordingContext } from '../../utils/validateRecordingContext'

/** What the learner sees of the recorded server stop in the replay debug session. */
export interface ReplayedStop {
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
export async function replaySavedServerStop(
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
