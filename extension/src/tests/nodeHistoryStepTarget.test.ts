import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { nodeHistoryStepTarget } from '../utils/nodeHistoryStepTarget'

/** A test replay's events of one type at their sequence; the moving helper reads only `type` and `sequence`. */
const event = (
  sequence: number,
  type: NodeTestHistoryEntry['type'],
): NodeTestHistoryEntry =>
  type === 'output'
    ? {
        type,
        sequence,
        elapsedMs: sequence,
        outputSequence: sequence,
        channel: 'stdout',
        text: '',
      }
    : type === 'result'
      ? {
          type,
          sequence,
          elapsedMs: sequence,
          exitCode: 0,
          signal: null,
          outputTail: '',
        }
      : {
          type,
          sequence,
          elapsedMs: sequence,
          index: 0,
          source: {
            path: 'src/jobs.ts',
            hash: 'a'.repeat(64),
            line: 1,
            column: 1,
          },
          frame: { name: 'schedule', line: 1, column: 1 },
          facts: [],
          debuggerSnapshot: {
            version: 1,
            frames: [],
            variables: [],
            limitations: [],
          },
        }

const entries = [
  event(1, 'output'),
  event(2, 'stop'),
  event(3, 'output'),
  event(4, 'stop'),
  event(5, 'result'),
]

// Value: protects=Previous stop and Next stop move from the selected event to the nearest stop that way, past outputs and the result, and Previous event and Next event to the adjacent event; fails_when=a stop move lands on an output or the result, skips a stop, or an event move skips an event; why_new=DS12 makes Previous stop and Next stop the transport's primary buttons; seam=none; no_claim=what the workspace selects or shows after the move
test('stop moves reach the nearest stop and event moves the adjacent event', () => {
  // Arrange / Act
  const moves = {
    nextStopFromStop: nodeHistoryStepTarget(entries, 2, 'next', 'stop'),
    previousStopFromOutput: nodeHistoryStepTarget(
      entries,
      3,
      'previous',
      'stop',
    ),
    nextStopFromLastStop: nodeHistoryStepTarget(entries, 4, 'next', 'stop'),
    nextEvent: nodeHistoryStepTarget(entries, 2, 'next'),
    previousEvent: nodeHistoryStepTarget(entries, 2, 'previous', 'event'),
    previousEventAtStart: nodeHistoryStepTarget(entries, 1, 'previous'),
  }

  // Assert
  assert.deepEqual(moves, {
    nextStopFromStop: 4,
    previousStopFromOutput: 2,
    nextStopFromLastStop: undefined,
    nextEvent: 3,
    previousEvent: 1,
    previousEventAtStart: undefined,
  })
})

// Value: protects=with no event selected, Next reaches the first event or stop and Previous the last, so the transport works before the first selection; fails_when=a move without a selection does nothing or lands mid-history; why_new=the node-history-step handler kept this rule and now moves by stop too (DS12); seam=none; no_claim=the landing of an opened replay (DS1)
test('without a selection Next reaches the first event or stop and Previous the last', () => {
  // Arrange / Act
  const moves = [
    nodeHistoryStepTarget(entries, undefined, 'next'),
    nodeHistoryStepTarget(entries, undefined, 'previous'),
    nodeHistoryStepTarget(entries, undefined, 'next', 'stop'),
    nodeHistoryStepTarget(entries, undefined, 'previous', 'stop'),
  ]

  // Assert
  assert.deepEqual(moves, [1, 5, 2, 4])
})
