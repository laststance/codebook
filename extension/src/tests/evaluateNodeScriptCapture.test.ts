import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeScriptHistoryEntry } from '../nodeScriptHistorySchemas'
import { evaluateNodeScriptCapture } from '../utils/evaluateNodeScriptCapture'

const header = { declaredStops: [] } as never

const end = (fields: Record<string, unknown>) =>
  ({
    type: 'end',
    sequence: 1,
    elapsedMs: 5,
    stopsReached: [0, 1],
    stopsNeverReached: [],
    ...fields,
  }) as unknown as NodeScriptHistoryEntry

const codes = (entries: NodeScriptHistoryEntry[], facts = {}) =>
  evaluateNodeScriptCapture(header, entries, facts).map((reason) => reason.code)

// Value: protects=a script history names a gap for an end at a limit, an unreadable exit code or a recording that stopped without its end, and none for a nonzero exit or a signal; fails_when=a limit end seals complete, a nonzero exit becomes a gap, or an interrupted journal without an end seals complete; why_new=the history tests seal stopped ends and budget gaps only; seam=none; no_claim=how the writer calls the evaluator
test('a limit end, an unreadable exit and an interrupted recording are capture gaps while a nonzero exit and a signal are not', () => {
  // Arrange
  const entries = {
    limit: [end({ kind: 'limit', limit: 'pause-hold' })],
    unreadable: [end({ kind: 'exited', exitUnknown: 'no code' })],
    nonzero: [end({ kind: 'exited', exitCode: 3 })],
    signal: [end({ kind: 'signal', signal: 'SIGSEGV' })],
    none: [],
  }

  // Act
  const result = {
    limit: evaluateNodeScriptCapture(header, entries.limit)[0],
    unreadable: codes(entries.unreadable),
    nonzero: codes(entries.nonzero),
    signal: codes(entries.signal),
    interrupted: codes(entries.none, { interrupted: true }).slice(0, 1),
    appendFailed: codes(entries.none, {
      interrupted: true,
      appendFailure: { lastEntry: 'stop 1', cause: 'disk' },
    }).includes('SCRIPT_HISTORY_END_MISSING'),
  }

  // Assert
  assert.equal(result.limit?.code, 'SCRIPT_HISTORY_RUN_LIMIT')
  assert.deepEqual(result.limit?.params, { limit: 'pause-hold' })
  assert.deepEqual(result.unreadable, ['SCRIPT_HISTORY_EXIT_UNKNOWN'])
  assert.deepEqual(result.nonzero, [])
  assert.deepEqual(result.signal, [])
  assert.deepEqual(result.interrupted, ['SCRIPT_HISTORY_END_MISSING'])
  assert.equal(result.appendFailed, false)
})
