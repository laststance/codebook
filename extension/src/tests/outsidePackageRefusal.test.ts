import assert from 'node:assert/strict'
import { test } from 'node:test'

import { outsidePackageRefusal } from '../nextRefusals'

// protects=DX-15/AC 3: a stop outside the package is refused NEXT_STOP_NOT_SEALED with reason outside-package, every offending file, the package root, sideEffects none and no router; fails_when=a router field appears, a file is missing, or the recovery claims a started server; no_claim=that a run resolves the stop files (the configured run's own path)
test('a stop outside the package is refused before any process with its own details and recovery', () => {
  // Arrange
  const files = ['packages/ui/src/button.tsx', 'packages/ui/src/card.tsx']
  // Act
  const refusal = outsidePackageRefusal('examples/react/nextjs', files)
  const described = refusal.describe()
  // Assert
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(refusal.details, {
    reason: 'outside-package',
    files,
    packageRoot: 'examples/react/nextjs',
    sideEffects: 'none',
  })
  assert.match(described.recovery, /Nothing was started/)
  assert.match(described.recovery, /details\.files/)
  assert.doesNotMatch(
    described.recovery,
    /Codebook stops the server it started/,
  )
})
