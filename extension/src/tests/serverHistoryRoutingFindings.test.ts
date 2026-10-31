import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  NODE_SERVER_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_DIRECTORY,
} from '../constants'
import { StudyError } from '../errors'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { createHarness } from './helpers'
import {
  openServerRepository,
  HANDLER_SOURCE_TEXT,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import { saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=one unreadable profile folder leaves the other profile listed and names only its own profile as unavailable; fails_when=the listing rejects and hides the readable profile; no_claim=the library's reporting of the failure
test('an unreadable server history folder leaves the test histories listed and marks only the server profile unavailable', async (context) => {
  // Arrange
  const { repository, learningDirectory } = await openServerRepository(context)
  await mkdir(learningDirectory, { recursive: true })
  // A regular file where the server folder belongs cannot be listed.
  await writeFile(join(learningDirectory, NODE_SERVER_HISTORY_DIRECTORY), 'x')
  await mkdir(join(learningDirectory, NODE_TEST_HISTORY_DIRECTORY), {
    recursive: true,
  })

  // Act
  const listing = await repository.listByProfile()

  // Assert
  assert.deepEqual(listing.servers, [])
  assert.deepEqual(
    listing.unavailable.map((profile) => profile.profile),
    ['node-server'],
  )
})

// protects=a server study id sent through the Study pane's material message is saved in the server store; fails_when=the save goes to the test store and answers not found; no_claim=the material's rendering
test('learning material saved for a server study id is kept with the server history', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository)
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository

  // Act
  const material = await harness.service.explainNodeHistory({
    studyId: header.studyId,
    expectedRevision: 0,
    content: {
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
    },
  })

  // Assert
  assert.equal(material.revision, 1)
  assert.equal(
    (await repository.serverHistories.readLearningMaterial(header.studyId))
      ?.revision,
    1,
  )
})

// protects=an event-detail URI of a test history answers the not-found shape the resources use for an unknown resource; fails_when=it answers an invalid-cursor error; no_claim=server histories' own event detail
test('an event detail URI of a test history is answered as an unknown resource', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  const { studyId } = await saveTwoStopNodeHistory(repository.testHistories)

  // Act
  const refusals = await Promise.all(
    [`events/through/3`].map((suffix) =>
      readResource(
        harness.service,
        `codebook://node-history/${studyId}/${suffix}`,
      ).catch((error: unknown) => error),
    ),
  )

  // Assert
  for (const refusal of refusals) {
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'NOT_FOUND')
    assert.equal(refusal.message, 'Unknown resource.')
  }
})
