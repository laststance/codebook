import assert from 'node:assert/strict'
import { test } from 'node:test'

import { moduleScopePositionOf } from '../utils/moduleScopePositionOf'

// Value: protects=AC 2 and AC 5 (values of a module evaluation): js-debug's chain for a pause in Next's eval-wrapped module starts with the module's Eval scope, which has no hint, and that scope is the one holding the module's own bindings; fails_when=the Eval scope is not found, so a module evaluation saves no value (native C86-2); no_claim=the translated scope name, which is never read
test('the Eval scope that opens a module evaluation chain is the module scope', () => {
  // Arrange
  const scopes = [
    { expensive: false },
    { presentationHint: 'arguments', expensive: false },
    { expensive: true },
  ]

  // Act
  const position = moduleScopePositionOf(scopes)

  // Assert
  assert.equal(position, 0)
})

// Value: protects=a module-scope statement inside a top-level block: the block comes first as local values and the module's Eval scope right after it is still found; fails_when=the search stops at the first hinted scope, so a stop inside a top-level `if` block loses the module's bindings; no_claim=nested functions, whose own Local scope comes first and is not a module evaluation
test('a top-level block before the Eval scope still lets the module scope be found', () => {
  // Arrange
  const scopes = [
    { presentationHint: 'locals' },
    { expensive: false },
    { presentationHint: 'arguments' },
    { expensive: true },
  ]

  // Act
  const position = moduleScopePositionOf(scopes)

  // Assert
  assert.equal(position, 1)
})

// Value: protects=the capture's secret boundary: a frame whose own scopes end at a closure has no module scope, and the global scope is never taken for one; fails_when=the global or a closure is copied into saved history, with `process` and database clients; no_claim=what the Local scope itself holds
test('a chain whose own scopes end at a closure has no module scope to copy', () => {
  // Arrange
  const scopes = [
    { presentationHint: 'locals' },
    { presentationHint: 'arguments' },
    { expensive: true },
  ]

  // Act
  const position = moduleScopePositionOf(scopes)

  // Assert
  assert.equal(position, undefined)
})

// Value: protects=the capture's size and secret boundary for scopes js-debug marks expensive: the Global scope and an ES Module scope are never taken for a module evaluation's own scope; fails_when=a pause at a script's top level copies the whole global object; no_claim=Vite's native ES modules, whose Module scope this cycle leaves out
test('an expensive scope without a hint is never taken for the module scope', () => {
  // Arrange
  const scopes = [{ expensive: true }]

  // Act
  const position = moduleScopePositionOf(scopes)

  // Assert
  assert.equal(position, undefined)
})
