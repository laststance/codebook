import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextNodeScriptState } from '../utils/nextNodeScriptState'

type View = NonNullable<Parameters<typeof nextNodeScriptState>[0]>

/** A running view that has not paused, ended or been held. */
const running = (fields: Partial<View> = {}): View => ({
  state: 'running',
  pauseGeneration: 2,
  ...fields,
})

const calm = { failed: false, ended: false }

// Value: protects=what a script continuation reports next is decided in a fixed order: failure, the script's own end, a stop, a learner hold, a new pause; fails_when=a stopped end is taken for the script ending by itself, the pause being continued is taken for the next one, or a failure is hidden by an end; why_new=the service tests drive only paused and ended; seam=none; no_claim=the wait loop that calls it
test('a script continuation reports failure first, then its own end, a stop, a learner hold and only a newer pause', () => {
  // Arrange
  const exited = { kind: 'exited', exitCode: 0 } as NonNullable<View['end']>
  const stoppedEnd = { kind: 'stopped' } as NonNullable<View['end']>
  const held = { reason: 'learner' } as NonNullable<View['heldPause']>

  // Act
  const results = [
    nextNodeScriptState(running({ end: exited }), 2, {
      failed: true,
      ended: true,
    }),
    nextNodeScriptState(running({ end: exited }), 2, calm),
    nextNodeScriptState(running({ end: stoppedEnd }), 2, calm),
    nextNodeScriptState(running(), 2, { failed: false, ended: true }),
    nextNodeScriptState(running({ state: 'stopping' }), 2, calm),
    nextNodeScriptState(running({ state: 'paused', heldPause: held }), 2, calm),
    nextNodeScriptState(running({ state: 'paused' }), 2, calm),
    nextNodeScriptState(
      running({ state: 'paused', pauseGeneration: 3 }),
      2,
      calm,
    ),
    nextNodeScriptState(undefined, 2, calm),
  ]

  // Assert
  assert.deepEqual(results, [
    'failure',
    'ended',
    undefined,
    'stopped',
    'stopped',
    'learner-paused',
    undefined,
    'paused',
    undefined,
  ])
})
