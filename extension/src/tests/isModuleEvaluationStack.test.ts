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
  assert.equal(result, true)
})
