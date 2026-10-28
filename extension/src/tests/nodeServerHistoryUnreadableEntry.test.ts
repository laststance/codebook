import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a stop that cannot be restored answers EVIDENCE_UNAVAILABLE naming the history and the events list; fails_when=an agent reads a raw ZodError; no_claim=how a stop became unreadable (no journal the reader accepts restores to an invalid snapshot, so the store is made to return one)
test('a stop that cannot be restored answers a coded EVIDENCE_UNAVAILABLE, not a raw schema error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository)
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  // A stop whose restored snapshot breaks the variable tree rules, which no accepted journal holds: the store is made to return it.
  const store = repository.serverHistories
  const read = store.read.bind(store)
  context.mock.method(store, 'read', async (studyId: string) => {
    const history = await read(studyId)
    return {
      ...history,
      entries: history.entries.map((entry) =>
        entry.type === 'stop'
          ? {
              ...entry,
              debuggerSnapshot: {
                ...entry.debuggerSnapshot,
                variables: [
                  {
                    name: 'a',
                    value: '1',
                    children: [9],
                    unavailable: undefined,
                  },
                ],
              },
            }
          : entry,
      ),
    }
  })

  // Act
  const reading = readResource(
    harness.service,
    `codebook://node-history/${header.studyId}/events/${sequences.stops[0]}`,
  )

  // Assert
  await assert.rejects(reading, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'EVIDENCE_UNAVAILABLE')
    assert.match(
      error.message,
      new RegExp(
        `^The history ${header.studyId} holds a stop that cannot be restored \\(.+ is invalid\\)\\. Read codebook://node-history/${header.studyId}/events for the events that verify`,
      ),
    )
    return true
  })
})
