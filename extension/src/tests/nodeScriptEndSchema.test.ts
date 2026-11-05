import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeScriptHistoryEntrySchema } from '../nodeScriptHistorySchemas'

const BASE = {
  type: 'end',
  sequence: 1,
  elapsedMs: 5,
  stopsReached: [],
  stopsNeverReached: [],
} as const

/** Whether the schema accepts an end entry with the given fields. */
const accepts = (fields: Record<string, unknown>) =>
  nodeScriptHistoryEntrySchema.safeParse({ ...BASE, ...fields }).success

// protects=an end entry's kind agrees with the fields that tell its cause; fails_when=an exited end without exit code or reason, a signal end without signal, a limit end without limit, or a stopped end with a limit or signal parses; no_claim=the run building those ends
test('an end entry whose kind lacks its cause field or carries another kind field is refused', () => {
  // Arrange
  const invalid: Array<Record<string, unknown>> = [
    { kind: 'exited' },
    { kind: 'exited', exitCode: null },
    { kind: 'signal' },
    { kind: 'signal', signal: null },
    { kind: 'limit' },
    { kind: 'stopped', limit: 'running-time' },
    { kind: 'stopped', signal: 'SIGTERM' },
  ]

  // Act
  const accepted = invalid.map(accepts)

  // Assert
  assert.deepEqual(accepted, [false, false, false, false, false, false, false])
})

// protects=the ends a run really produces still parse; fails_when=the refinement refuses an exit code of 0, an unreadable exit, a signal, a limit or a stopped end; no_claim=ends no run produces
test('the ends a run produces parse', () => {
  // Arrange
  const valid: Array<Record<string, unknown>> = [
    { kind: 'exited', exitCode: 0 },
    { kind: 'exited', exitCode: 3 },
    { kind: 'exited', exitUnknown: 'The process exit code could not be read.' },
    { kind: 'signal', signal: 'SIGSEGV' },
    { kind: 'limit', limit: 'running-time' },
    { kind: 'stopped' },
  ]

  // Act
  const accepted = valid.map(accepts)

  // Assert
  assert.deepEqual(accepted, [true, true, true, true, true, true])
})
