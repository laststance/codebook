import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NodeHistoryPlaybackController } from '../utils/nodeHistoryPlaybackController'

/** A controller over three events with the recording ending at 900 ms, after the last event at 200 ms, on a clock the test moves. */
function controllerWithTerminalSpan(endedAtMs?: number) {
  const clock = { now: 0 }
  const presented: number[] = []
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
    },
    changed() {},
    now: () => clock.now,
    manualTicks: true,
  })
  controller.open(
    [
      { sequence: 1, elapsedMs: 0 },
      { sequence: 2, elapsedMs: 100 },
      { sequence: 3, elapsedMs: 200 },
    ],
    1,
    endedAtMs,
  )
  return { controller, clock, presented }
}

// protects=a seek to the recording's end lands at the end and keeps the last event selected; fails_when=the playhead snaps back to the last event's time; no_claim=the slider drawing
test('seeking to the end of a server replay rests the playhead at the end on the last event', async () => {
  // Arrange
  const { controller } = controllerWithTerminalSpan(900)

  // Act
  await controller.seek(900)

  // Assert
  assert.equal(controller.state().positionMs, 900)
  assert.equal(controller.state().sequence, 3)
  assert.equal(controller.state().endMs, 900)
})

// protects=Play from the last event runs on to the recording's end and pauses there; fails_when=Play does nothing at the last event or ends at the last event's time; no_claim=wall-clock pacing beyond the dwell bound
test('Play from the last event of a server replay reaches the recording end and pauses there', async () => {
  // Arrange
  const { controller, clock } = controllerWithTerminalSpan(900)
  await controller.seek(200)
  assert.equal(controller.state().positionMs, 200)

  // Act
  controller.play()
  clock.now = 5_000
  await controller.tick()

  // Assert
  assert.equal(controller.state().mode, 'paused')
  assert.equal(controller.state().positionMs, 900)
  assert.equal(controller.state().sequence, 3)
})

// protects=Play started before the last event passes through it to the end instead of pausing on it; fails_when=the last event's arrival pauses Play although time remains; no_claim=none
test('Play through the last event of a server replay continues to the end', async () => {
  // Arrange
  const { controller, clock } = controllerWithTerminalSpan(900)
  controller.play()

  // Act
  clock.now = 5_000
  await controller.tick()
  clock.now = 10_000
  await controller.tick()
  const atLastEvent = controller.state()
  clock.now = 15_000
  await controller.tick()

  // Assert
  assert.equal(atLastEvent.mode, 'playing')
  assert.equal(atLastEvent.positionMs, 200)
  assert.equal(controller.state().mode, 'paused')
  assert.equal(controller.state().positionMs, 900)
})

// protects=selecting an event leaves the end; fails_when=the playhead stays at the end after the learner picks the last event; no_claim=none
test('selecting the last event after the end returns the playhead to that event', async () => {
  // Arrange
  const { controller } = controllerWithTerminalSpan(900)
  await controller.seek(900)

  // Act
  controller.select(3)

  // Assert
  assert.equal(controller.state().positionMs, 200)
})

// protects=a test replay (no recorded end) keeps its range at the last event and refuses a seek beyond it; fails_when=a recording without a terminal span gains a reachable end; no_claim=none
test('a replay with no time after its last event still ends and refuses seeks at the last event', async () => {
  // Arrange
  const { controller } = controllerWithTerminalSpan(undefined)

  // Act
  const seek = controller.seek(900)

  // Assert
  await assert.rejects(seek, /outside the verified range/)
  assert.equal(controller.state().endMs, 200)
})
