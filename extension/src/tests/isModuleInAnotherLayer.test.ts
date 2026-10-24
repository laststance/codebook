import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isModuleInAnotherLayer } from '../utils/isModuleInAnotherLayer'

// Value: protects=only the same module of another webpack layer being read as a further instance of a declared stop's module; fails_when=a module of another path, the sealed script itself or a non-webpack address is taken for an instance; no_claim=that the instance's map maps onto the frozen original (checked when it is read)
test('names the same module of another webpack layer and nothing else as an instance', () => {
  // Arrange
  const sealed = 'webpack-internal:///(action-browser)/./auth.config.ts'
  // Act
  const results = [
    isModuleInAnotherLayer(
      sealed,
      'webpack-internal:///(middleware)/./auth.config.ts',
    ),
    isModuleInAnotherLayer(sealed, sealed),
    isModuleInAnotherLayer(
      sealed,
      'webpack-internal:///(middleware)/./auth.ts',
    ),
    isModuleInAnotherLayer(sealed, 'file:///app/auth.config.ts'),
  ]
  // Assert
  assert.deepEqual(results, [true, false, false, false])
})
