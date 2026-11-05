import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isModuleEvaluationStack } from '../utils/isModuleEvaluationStack'

const MODULE_URL = 'webpack-internal:///(rsc)/./db/index.ts'

/** The recorded stack of Next 16 at the first evaluation of `db/index.ts`. */
const EVALUATION_FRAMES = [
  { functionName: '', location: { scriptId: '12' } },
  { functionName: '(rsc)/./db/index.ts', location: { scriptId: '3' } },
  { functionName: '__webpack_require__', location: { scriptId: '3' } },
]

test('the anonymous top frame of the module script above its factory is a module evaluation', () => {
  // Arrange
  const frames = EVALUATION_FRAMES
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, true)
})

test('a named top frame in the module script is a call of its function, not an evaluation', () => {
  // Arrange
  const frames = [
    { functionName: 'getUser', location: { scriptId: '12' } },
    { functionName: 'Page', location: { scriptId: '14' } },
  ]
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, false)
})

test('an anonymous arrow called from another script is not an evaluation of the module', () => {
  // Arrange
  const frames = [
    { functionName: '', location: { scriptId: '12' } },
    { functionName: 'render', location: { scriptId: '14' } },
  ]
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, false)
})

test('a React server copy with the stack of an evaluation is never a module evaluation', () => {
  // Arrange
  const copyUrl = `about://React/Server/${MODULE_URL}?107`
  // Act
  const result = isModuleEvaluationStack(EVALUATION_FRAMES, '12', copyUrl)
  // Assert
  assert.equal(result, false)
})

test('a frame without a location is not an evaluation and does not throw', () => {
  // Arrange
  const frames = [
    { functionName: '', location: { scriptId: '12' } },
    { functionName: '(rsc)/./db/index.ts', location: null },
  ]
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, false)
})

// Value: protects=the README and help promise (a function called while the module loads): a stop in a function of the module that its top-level code calls is a module evaluation, so the window pauses it instead of resuming it; fails_when=only a top frame directly above the factory counts and the initializer's stop is resumed, then never reached (Codex review); no_claim=js-debug's frame names
test('a named function the module calls while it loads, above the top-level frame and the factory, is a module evaluation', () => {
  // Arrange
  const frames = [
    { functionName: 'createClient', location: { scriptId: '12' } },
    { functionName: '', location: { scriptId: '12' } },
    { functionName: '(rsc)/./db/index.ts', location: { scriptId: '3' } },
    { functionName: '__webpack_require__', location: { scriptId: '3' } },
  ]
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, true)
})

// Value: protects=an immediately invoked function at module scope runs during the evaluation: its anonymous frame above the top-level frame is still a module evaluation; fails_when=the IIFE's stop is resumed as a call; no_claim=none beyond protects
test('an immediately invoked function above the top-level frame and the factory is a module evaluation', () => {
  // Arrange
  const frames = [
    { functionName: '', location: { scriptId: '12' } },
    { functionName: '', location: { scriptId: '12' } },
    { functionName: '(rsc)/./db/index.ts', location: { scriptId: '3' } },
  ]
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, true)
})

// Value: protects=a function of the module called by another script's code (a render) is no evaluation, even when it is deep in the stack: no top-level frame of the module sits above its factory; fails_when=any frame of the module counts and a render call is published as a module evaluation; no_claim=none beyond protects
test('a function of the module called from a render, with no top-level frame above the factory, is not an evaluation', () => {
  // Arrange
  const frames = [
    { functionName: 'getUser', location: { scriptId: '12' } },
    { functionName: 'Page', location: { scriptId: '14' } },
    { functionName: 'renderWithHooks', location: { scriptId: '3' } },
  ]
  // Act
  const result = isModuleEvaluationStack(frames, '12', MODULE_URL)
  // Assert
  assert.equal(result, false)
})
