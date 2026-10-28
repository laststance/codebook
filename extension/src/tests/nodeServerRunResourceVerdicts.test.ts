import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createHarness } from './helpers'
import { HANDLER_SOURCE_TEXT } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { serverMaterialCiting } from './utils/serverLearningMaterial'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

const SOURCE_HASH = sha256(HANDLER_SOURCE_TEXT)

/** A server run with a sealed history of two stops and a response, and a reader of its run resource. */
async function sealedRun(context: Parameters<typeof startHistoryServerRun>[1]) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startHistoryServerRun(harness, context)
  const { service, record, run } = started
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const studyId = `${service.instanceId}_${record.id}`
  const entries = (await started.repository.serverHistories.read(studyId))
    .entries
  const sequenceOf = (type: string, nth = 0): number =>
    entries.filter((entry) => entry.type === type)[nth]!.sequence
  const runResource = async () => {
    const resource = await readResource(service, service.uri(record.id))
    return JSON.parse('text' in resource ? resource.text : '{}') as {
      nodeServer?: {
        learningCoverage?: string
        learningMissing?: unknown[]
        captureMissing?: unknown[]
        materialRevision?: number
      }
      nextActions: string[]
    }
  }
  return { ...started, studyId, sequenceOf, runResource }
}

// protects=a material another window saved after this window sealed the history shows in this window's run resource when it is read; fails_when=the resource keeps the verdicts taken at the seal and still offers save-node-learning; no_claim=this window's own saves (covered by the publication test)
test('a material saved from another window shows in the run resource of the window that sealed the history', async (context) => {
  // Arrange
  const sealed = await sealedRun(context)
  const before = await sealed.runResource()
  const stopHit = (nth: number) => ({
    type: 'stop' as const,
    sequence: sealed.sequenceOf('stop', nth),
    sourceHash: SOURCE_HASH,
  })

  // Act
  await sealed.repository.serverHistories.saveLearningMaterial(
    sealed.studyId,
    0,
    serverMaterialCiting([
      { type: 'request', sequence: sealed.sequenceOf('request') },
      stopHit(0),
      stopHit(1),
      { type: 'response', sequence: sealed.sequenceOf('response') },
    ]),
  )
  const after = await sealed.runResource()

  // Assert
  assert.equal(before.nodeServer?.learningCoverage, 'none')
  assert.equal(after.nodeServer?.learningCoverage, 'complete')
  assert.deepEqual(after.nodeServer?.learningMissing, [])
  assert.equal(after.nodeServer?.materialRevision, 1)
  assert.equal(after.nextActions.includes('save-node-learning'), false)
})

// protects=a material that does not cover a stop leaves that stop in learningMissing when the resource is read, and the missing list follows the stored material; fails_when=a stop the material leaves out reads as covered; no_claim=the wording of the missing entry
test('a stop the stored material does not cite stays in learningMissing of the run resource', async (context) => {
  // Arrange
  const sealed = await sealedRun(context)
  await sealed.repository.serverHistories.saveLearningMaterial(
    sealed.studyId,
    0,
    serverMaterialCiting([
      { type: 'request', sequence: sealed.sequenceOf('request') },
      {
        type: 'stop',
        sequence: sealed.sequenceOf('stop', 0),
        sourceHash: SOURCE_HASH,
      },
      { type: 'response', sequence: sealed.sequenceOf('response') },
    ]),
  )

  // Act
  const resource = await sealed.runResource()

  // Assert
  assert.equal(resource.nodeServer?.learningCoverage, 'partial')
  assert.equal(resource.nodeServer?.learningMissing?.length, 1)
  assert.equal(sealed.sequenceOf('stop', 1) > 0, true)
})

// protects=a stop recorded after a material was saved appears in learningMissing once the history is sealed; fails_when=the missing list is taken before the later stop or ignores it; no_claim=a material saved by the learner's Save
test('a stop recorded after the material was saved appears in learningMissing of the sealed run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startHistoryServerRun(harness, context)
  const { service, record, run } = started
  await run.sendRequest('k1')
  run.pauseAt(0)
  const studyId = `${service.instanceId}_${record.id}`
  const readLive = () => started.repository.serverHistories.read(studyId)
  await waitUntil(
    async () =>
      (await readLive()).entries.some((entry) => entry.type === 'stop'),
    'the first stop is written',
    5_000,
  )
  const live = await readLive()
  const stopFirst = live.entries.find((entry) => entry.type === 'stop')!
  const request = live.entries.find((entry) => entry.type === 'request')!
  await started.repository.serverHistories.saveLearningMaterial(
    studyId,
    0,
    serverMaterialCiting([
      { type: 'request', sequence: request.sequence },
      { type: 'stop', sequence: stopFirst.sequence, sourceHash: SOURCE_HASH },
    ]),
  )

  // Act
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const resource = await readResource(service, service.uri(record.id))
  const state = JSON.parse('text' in resource ? resource.text : '{}') as {
    nodeServer?: { learningMissing?: Array<{ type?: string }> }
  }

  // Assert
  const missingTypes = state.nodeServer?.learningMissing?.map(
    (entry) => entry.type,
  )
  assert.equal(missingTypes?.includes('stop'), true)
})
