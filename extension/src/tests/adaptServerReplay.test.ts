import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { adaptServerReplay } from '../utils/adaptServerReplay'
import { buildServerReplayModel } from '../utils/buildServerReplayModel'

import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// Value: protects=a server stop's recorded facts reach the shared replay path in recorded order, so the native debugger lists them; fails_when=facts revert to [] or an unknown-mode key is guessed into a fact; why_new=F3 toTestShapedFacts (server stops) had no test naming it; seam=none; no_claim=how the native debugger renders the facts (replayDebug tests)
test('a server replay hands a stop its recorded value and type facts in recorded order and skips keys with no known mode', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const { header } = await writeServerHistory(repository)
  const history = await repository.serverHistories.read(header.studyId)
  const built = buildServerReplayModel(history, {
    saved: true,
    captureComplete: true,
    learningCoverage: 'complete',
  })
  const model = {
    ...built,
    events: built.events.map((event) =>
      event.type === 'stop'
        ? {
            ...event,
            facts: {
              'value:req.url': '/a',
              'type:items': 'array',
              'value:count': 3,
              'note:other': 'ignored',
            },
          }
        : event,
    ),
  }

  // Act
  const replay = adaptServerReplay(model, [])

  // Assert
  const stop = replay.history.entries.find((entry) => entry.type === 'stop')
  assert.deepEqual(stop?.type === 'stop' ? stop.facts : undefined, [
    { path: 'req.url', mode: 'value', display: '/a' },
    { path: 'items', mode: 'type', display: 'array' },
    { path: 'count', mode: 'value', display: '3' },
  ])
})

// protects=a server stop's fact the shared test fact schema would refuse (an empty path, a path over 256 characters, a display over 1,024 characters) is skipped, never passed on or truncated; fails_when=such a fact reaches the replay path's history; no_claim=how the facts are rendered (replayDebug tests)
test('a server replay skips a fact with an empty path or an over-long path or display and keeps the readable ones', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const { header } = await writeServerHistory(repository)
  const history = await repository.serverHistories.read(header.studyId)
  const built = buildServerReplayModel(history, {
    saved: true,
    captureComplete: true,
    learningCoverage: 'complete',
  })
  const model = {
    ...built,
    events: built.events.map((event) =>
      event.type === 'stop'
        ? {
            ...event,
            facts: {
              'value:': 'empty path',
              'type:': 'empty type path',
              [`value:${'p'.repeat(257)}`]: 'long path',
              'value:long.display': 'd'.repeat(1_025),
              [`value:${'p'.repeat(256)}`]: 'd'.repeat(1_024),
              'value:req.url': '/a',
            },
          }
        : event,
    ),
  }

  // Act
  const replay = adaptServerReplay(model, [])

  // Assert
  const stop = replay.history.entries.find((entry) => entry.type === 'stop')
  assert.deepEqual(stop?.type === 'stop' ? stop.facts : undefined, [
    { path: 'p'.repeat(256), mode: 'value', display: 'd'.repeat(1_024) },
    { path: 'req.url', mode: 'value', display: '/a' },
  ])
})
