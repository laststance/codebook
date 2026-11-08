import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OperationRefusal } from '../configuredOperations'
import { operationRefusalText } from '../utils/operationRefusalText'

// Value: protects=a sign-in reason stays in the SIGN_IN_REQUIRED text; fails_when=the variant is dropped or reworded; no_claim=the message wording
test('writes the sign-in reason as the variant of a SIGN_IN_REQUIRED refusal', () => {
  // Arrange
  const refusal = new OperationRefusal('SIGN_IN_REQUIRED', 'Sign in first', {
    operationIndex: 0,
    reason: 'no-saved-session',
  })

  // Act
  const text = operationRefusalText(refusal)

  // Assert
  assert.equal(text, 'SIGN_IN_REQUIRED(no-saved-session): Sign in first')
})

// Value: protects=a press reason is never written as a sign-in reason; fails_when=a SIGN_IN_REQUIRED refusal carrying a press reason is formatted with it as the variant; no_claim=the press refusal text
test('does not write a press reason as the sign-in reason of a SIGN_IN_REQUIRED refusal', () => {
  // Arrange
  const refusal = new OperationRefusal('SIGN_IN_REQUIRED', 'Sign in first', {
    operationIndex: 0,
    reason: 'press-secret-control',
  })

  // Act
  const text = operationRefusalText(refusal)

  // Assert
  assert.equal(text, 'SIGN_IN_REQUIRED: Sign in first')
})
