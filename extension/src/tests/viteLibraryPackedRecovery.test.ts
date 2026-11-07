import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  viteLibraryBuildChangedFailure,
  viteLibraryRefusal,
} from '../viteLibraryRefusals'

const IDENTITY = {
  packageRoot: 'examples/react/basic',
  library: '@scope/core',
  file: 'packages/core/src/a.ts',
}
const PACKED = { revision: 'abc1234' }

// protects=a packed-route lazy-import refusal tells the agent the browser had loaded the page and side effects are unknown; fails_when=the recovery says no browser opened or sideEffects partial
test('packed lazy-import refusal recovery says the page had loaded and side effects are unknown', () => {
  // Arrange
  const request = {
    ...IDENTITY,
    reason: 'library-build-unmapped' as const,
    cause: 'lazy-import' as const,
    packed: PACKED,
  }
  // Act
  const error = viteLibraryRefusal(request)
  // Assert
  assert.equal(error.details?.sideEffects, 'unknown')
  assert.match(error.recoveryOverride ?? '', /details\.sideEffects is unknown/)
  assert.match(
    error.recoveryOverride ?? '',
    /the browser had loaded the entry page/,
  )
  assert.doesNotMatch(error.recoveryOverride ?? '', /No browser was opened/)
  assert.doesNotMatch(error.recoveryOverride ?? '', /is partial/)
})

// protects=a packed-route refusal before the browser opens keeps its partial side effects wording; fails_when=a non-lazy cause loses the no-browser sentence
test('packed no-map refusal recovery keeps no browser opened and partial side effects', () => {
  // Arrange
  const request = {
    ...IDENTITY,
    reason: 'library-build-unmapped' as const,
    cause: 'no-map' as const,
    packed: PACKED,
  }
  // Act
  const error = viteLibraryRefusal(request)
  // Assert
  assert.equal(error.details?.sideEffects, 'partial')
  assert.match(error.recoveryOverride ?? '', /No browser was opened/)
  assert.match(error.recoveryOverride ?? '', /details\.sideEffects is partial/)
})

// protects=a packed-route build change recovery asks for a new start like its message; fails_when=the recovery tells the learner to finish the rebuild themselves
test('packed library-build-changed recovery asks for a new start that packs the library again', () => {
  // Arrange
  const identity = IDENTITY
  // Act
  const error = viteLibraryBuildChangedFailure(identity, PACKED)
  // Assert
  assert.equal(error.details?.sideEffects, 'unknown')
  assert.match(error.message, /Start the run again to build and pack/)
  assert.match(error.recoveryOverride ?? '', /ask for a new start/)
  assert.match(error.recoveryOverride ?? '', /packs the library again/)
  assert.doesNotMatch(error.recoveryOverride ?? '', /finish the rebuild/)
})

// protects=the workspace-library build change recovery stays the rebuild wording; fails_when=the unpacked sentence changes
test('workspace library-build-changed recovery still asks the learner to finish the rebuild', () => {
  // Arrange
  const identity = IDENTITY
  // Act
  const error = viteLibraryBuildChangedFailure(identity)
  // Assert
  assert.match(error.recoveryOverride ?? '', /finish the rebuild/)
})
