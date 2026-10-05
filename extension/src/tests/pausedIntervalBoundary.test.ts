import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RecordedEvent } from '../runtimeSupport/evidence'
import { pausedIntervalBoundary } from '../utils/pausedIntervalBoundary'

/** Builds one journal entry at a time on the run clock; the sequence follows the time. @example journalEntry('session.terminated', 150, { sessionId: 'server-session' }) */
const journalEntry = (
  type: string,
  elapsedMs: number,
  detail: unknown,
): RecordedEvent => ({
  sequence: elapsedMs,
  wallTime: '2026-10-04T00:00:00.000Z',
  elapsedMs,
  type,
  detail,
})

// Cycle 0045 (X7-C2.3): red while every session.terminated after a commit ended the stop's paused interval, also the end of a session the stop is not paused in, so the replay showed source and values as missing while they were held.
test('a held stop’s replay interval is not ended by the end of another debug session, and is ended by the end of the session it is paused in', () => {
  // Arrange: a server stop committed at 100 ms in server-session; a worker session of the browser ends at 150 ms, the stop is continued at 400 ms.
  const serverStop = {
    elapsedMs: 100,
    participant: 'server',
    pause: { generation: 1, sessionId: 'server-session' },
  }
  const workerEnded = journalEntry('session.terminated', 150, {
      sessionId: 'browser-worker',
    }),
    continued = journalEntry('continue.accepted', 400, {
      sessionId: 'server-session',
      threadId: 1,
      generation: 1,
    }),
    ownSessionEnded = journalEntry('session.terminated', 300, {
      sessionId: 'server-session',
    })
  // Act
  const afterAnotherSession = pausedIntervalBoundary(serverStop, [
    workerEnded,
    continued,
  ])
  const afterItsOwnSession = pausedIntervalBoundary(serverStop, [
    workerEnded,
    ownSessionEnded,
    continued,
  ])
  // Assert
  assert.deepEqual(
    {
      afterAnotherSession: {
        type: afterAnotherSession?.type,
        elapsedMs: afterAnotherSession?.elapsedMs,
      },
      afterItsOwnSession: {
        type: afterItsOwnSession?.type,
        elapsedMs: afterItsOwnSession?.elapsedMs,
      },
    },
    {
      afterAnotherSession: { type: 'continue.accepted', elapsedMs: 400 },
      afterItsOwnSession: { type: 'session.terminated', elapsedMs: 300 },
    },
  )
})

// Cycle 0045 (X7-C2.3): the fallback; an entry that names no session cannot be compared and ends the interval as before.
test('a session end that names no session still ends a held stop’s replay interval', () => {
  // Arrange
  const serverStop = {
    elapsedMs: 100,
    participant: 'server',
    pause: { generation: 1, sessionId: 'server-session' },
  }
  // Act
  const boundary = pausedIntervalBoundary(serverStop, [
    journalEntry('session.terminated', 150, {}),
  ])
  // Assert
  assert.deepEqual(
    { type: boundary?.type, elapsedMs: boundary?.elapsedMs },
    { type: 'session.terminated', elapsedMs: 150 },
  )
})
