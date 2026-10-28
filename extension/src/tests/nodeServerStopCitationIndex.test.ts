import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  HANDLER_SOURCE_TEXT,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import { serverMaterialCiting } from './utils/serverLearningMaterial'

before(async () => {
  await realProcessStart(process.pid)
})

const SOURCE_HASH = sha256(HANDLER_SOURCE_TEXT)

/** A sealed history with two declared stops in one file, each hit once. */
async function twoStopHistory(
  context: Parameters<typeof openServerRepository>[0],
) {
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository, {
    declaredStops: 2,
    hits: [
      [0, 1],
      [1, 1],
    ],
    response: { status: 200, body: 'ok' },
  })
  return { repository, studyId: header.studyId, stops: sequences.stops }
}

// protects=a stop citation that names a declared stop is refused when the cited sequence is a hit of another declared stop of the same file, with the nearest sequences that are hits of the named stop; fails_when=the source hash alone accepts it; no_claim=a citation that names no declared stop
test('a stop citation of declaredStopIndex 0 at the hit of stop 1 is refused with the nearest valid sequence', async (context) => {
  // Arrange
  const { repository, studyId, stops } = await twoStopHistory(context)
  const material = serverMaterialCiting([
    {
      type: 'stop',
      sequence: stops[1]!,
      sourceHash: SOURCE_HASH,
      declaredStopIndex: 0,
    },
  ])

  // Act
  const refusal = await repository.serverHistories
    .saveLearningMaterial(studyId, 0, material)
    .catch((error: unknown) => error)

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_REFERENCE')
  assert.match(
    refusal.message,
    new RegExp(
      `sequence ${stops[1]} is a stop at src/handler.ts:\\d+ in the sealed history, but the step claims a stop with sourceHash ${SOURCE_HASH} of declaredStopIndex 0; expected sourceHash ${SOURCE_HASH} of declaredStopIndex 1\\. Nearest valid sequences for a stop with sourceHash ${SOURCE_HASH} of declaredStopIndex 0: ${stops[0]}\\.`,
    ),
  )
})

// protects=a stop citation of the right declared stop, and one that names none, are accepted; fails_when=the new check refuses a correct citation or an old one without an index; no_claim=coverage
test('a stop citation of its own declaredStopIndex, and one without an index, are saved', async (context) => {
  // Arrange
  const { repository, studyId, stops } = await twoStopHistory(context)
  const material = serverMaterialCiting([
    {
      type: 'stop',
      sequence: stops[1]!,
      sourceHash: SOURCE_HASH,
      declaredStopIndex: 1,
    },
    { type: 'stop', sequence: stops[0]!, sourceHash: SOURCE_HASH },
  ])

  // Act
  const saved = await repository.serverHistories.saveLearningMaterial(
    studyId,
    0,
    material,
  )

  // Assert
  assert.equal(saved.revision, 1)
})
