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

// protects=the library-modules command is accepted only with every field well-formed, so a malformed walk request never reaches the walk; fails_when=a missing or mistyped requestId, entries or libraryFolder is accepted; no_claim=the launcher's reaction to the refusal (see viteLauncher.test.ts)
test('accepts a well-formed library-modules command and rejects one with a missing or mistyped field', () => {
  // Arrange
  const wellFormed = {
    type: 'vite-library-modules',
    requestId: 3,
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  }
  const malformed = [
    { ...wellFormed, requestId: '3' },
    { ...wellFormed, requestId: 1.5 },
    { ...wellFormed, requestId: undefined },
    { ...wellFormed, entries: '/src/main.tsx' },
    { ...wellFormed, entries: ['/src/main.tsx', 7] },
    { ...wellFormed, entries: undefined },
    { ...wellFormed, libraryFolder: 5 },
    { ...wellFormed, libraryFolder: undefined },
  ]
  // Act
  const wellFormedResult = isViteLauncherCommand(wellFormed)
  const malformedResults = malformed.map((value) =>
    isViteLauncherCommand(value),
  )
  // Assert
  assert.equal(wellFormedResult, true)
  assert.deepEqual(malformedResults, [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ])
})
