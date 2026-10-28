import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  HANDLER_SOURCE_TEXT,
  openServerRepository,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a learning-material save reads and checks the journal before it takes the storage lock, so another window is never held up by the journal's read and parse; fails_when=the journal is read while this window holds writer.lock; no_claim=the lock's own release rules
test('a material save reads the journal before it takes the storage lock', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository)
  const store = repository.serverHistories
  const lockPath = join(learningDirectory, 'writer.lock')
  const read = store.read.bind(store)
  const lockedDuringRead: boolean[] = []
  store.read = async (studyId) => {
    lockedDuringRead.push(existsSync(lockPath))
    return read(studyId)
  }

  // Act
  await store.saveLearningMaterial(header.studyId, 0, {
    question: 'How does the server create an item?',
    title: 'Creating an item',
    summary: 'The handler stops once.',
    participants: [{ id: 'server', label: 'Handler' }],
    steps: [
      {
        id: 'stop',
        from: 'server',
        to: 'server',
        label: 'Stop',
        explanation: 'The handler stops at its first line.',
        evidence: 'observed',
        reference: {
          type: 'stop',
          sequence: sequences.stops[0]!,
          sourceHash: sha256(HANDLER_SOURCE_TEXT),
        },
      },
    ],
  })

  // Assert
  assert.deepEqual(lockedDuringRead, [false])
})
