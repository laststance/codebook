import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { readResource } from '../resources'

import { createHarness } from './helpers'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a pin past the journal's end (a huge `through`) reads as the journal's own end and never names a sequence that does not exist; fails_when=the page's uri carries the unclamped number; no_claim=the paging of long lists
test('an events read pinned past the end of the journal is pinned to the journal end', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  const { header } = await writeServerHistory(repository, { output: ['a\n'] })
  const entries = (await repository.serverHistories.read(header.studyId))
    .entries
  const last = entries.at(-1)!.sequence

  // Act
  const resource = await readResource(
    harness.service,
    `codebook://node-history/${header.studyId}/events/through/99999999999999999999`,
  )

  // Assert
  assert.equal(
    resource.uri,
    `codebook://node-history/${header.studyId}/events/through/${last}`,
  )
})
