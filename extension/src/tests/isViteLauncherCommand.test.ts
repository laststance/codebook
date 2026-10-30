import assert from 'node:assert/strict'
import test from 'node:test'

import { isViteLauncherCommand } from '../utils/isViteLauncherCommand'

// Value: protects=only the three protocol commands are accepted from IPC, so unknown data never means listen; fails_when=an unvalidated message is cast and used; why_new=final-round review C7; seam=none; no_claim=the launcher's reaction to the refusal
test('accepts the listen, refuse and await-optimizer commands and rejects any other IPC value', () => {
  // Arrange
  const values = [
    { type: 'vite-listen' },
    { type: 'vite-refuse' },
    { type: 'vite-await-optimizer' },
    { type: 'listen' },
    'vite-listen',
    null,
    undefined,
    {},
  ]
  // Act
  const results = values.map((value) => isViteLauncherCommand(value))
  // Assert
  assert.deepEqual(results, [
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
  ])
})
