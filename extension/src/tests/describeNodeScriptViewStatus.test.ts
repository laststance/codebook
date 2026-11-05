import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeScriptViewStatus } from '../utils/describeNodeScriptViewStatus'

// protects=the status bar's Save item words a script that exited with an unreadable code as unknown, never as "exited null"; fails_when=the item reads "Script exited null" or drops the known code; no_claim=the other states' words
test('the Save item says the exit code is unknown when a script exited with an unreadable code', () => {
  // Arrange
  const base = { state: 'ended', stops: [], pause: undefined } as const

  // Act
  const unknown = describeNodeScriptViewStatus({
    ...base,
    end: { kind: 'exited', exitCode: null, exitUnknown: 'unreadable' },
  } as never)
  const known = describeNodeScriptViewStatus({
    ...base,
    end: { kind: 'exited', exitCode: 3 },
  } as never)

  // Assert
  assert.equal(unknown, 'Script exited (exit code unknown)')
  assert.equal(known, 'Script exited 3')
})
