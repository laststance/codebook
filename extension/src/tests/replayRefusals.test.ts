import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NodeHistoryPlaybackController } from '../utils/nodeHistoryPlaybackController'
import {
  REPLAY_REFUSALS,
  replayNoStep,
  replayRefusal,
} from '../utils/replayRefusals'

// protects=a refusal names the replay that is shown in both forms, catalogued sentence by sentence; fails_when=a server refusal still says test replay or a test refusal says server replay; no_claim=every call site (the workspace tests cover the paging and navigation refusals)
test('a refusal reads in the words of the replay that is shown', () => {
  // Arrange
  const key = 'selectBeforePaging'

  // Act
  const test_ = replayRefusal(key, 'test')
  const server = replayRefusal(key, 'server')

  // Assert
  assert.equal(test_, 'Select the matching test replay before paging.')
  assert.equal(server, 'Select the matching server replay before paging.')
})

// protects=no server sentence of the catalog names a test replay and no test sentence names a server replay; fails_when=a catalogued pair is copied without its wording changed; no_claim=grammar
test('every catalogued server refusal names a server replay and no test replay', () => {
  // Arrange
  const pairs = Object.values(REPLAY_REFUSALS)

  // Act
  const mixedUp = pairs.filter(
    (pair) =>
      /test replay/.test(pair.server) ||
      /server replay/.test(pair.test) ||
      !/(server replay)/.test(pair.server) ||
      !/(test replay)/.test(pair.test),
  )

  // Assert
  assert.deepEqual(mixedUp, [])
})

// protects=the no-step refusal names the shown replay; fails_when=a server replay is told it has no step in a test replay; no_claim=the direction words
test('a missing step is refused in the words of the replay that is shown', () => {
  // Arrange
  const direction = 'next'

  // Act
  const server = replayNoStep('server', direction, 'stop')
  const test_ = replayNoStep('test', direction, undefined)

  // Assert
  assert.equal(server, 'There is no next stop in this server replay.')
  assert.equal(test_, 'There is no next event in this test replay.')
})

// protects=a seek outside a server replay's range is refused naming a server replay; fails_when=the controller words the refusal for a test replay while a server replay is open; no_claim=the Study pane's rendering
test('a seek outside the range of a server replay is refused naming a server replay', async () => {
  // Arrange
  const controller = new NodeHistoryPlaybackController({
    present: async () => {},
    changed() {},
    manualTicks: true,
    replayKind: () => 'server',
  })
  controller.open([{ sequence: 1, elapsedMs: 0 }], 1)

  // Act
  const seek = controller.seek(500)

  // Assert
  await assert.rejects(
    seek,
    /^Error: Seek lies outside the verified range of this server replay\.$/,
  )
})
