import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withoutInspectorBanner } from '../utils/withoutInspectorBanner'

// Value: protects=D33 tail decision: Node's inspector banner never fills the bounded output tail an agent reads after a failure; fails_when=a banner line survives or an API line is dropped; no_claim=the launcher's masking (ownedApiServer.test.ts)
test('the API output tail drops Node inspector banner lines and keeps the API own lines in order', () => {
  // Arrange
  const tail = [
    'Debugger listening on ws://127.0.0.1:9229/abc',
    'For help, see: https://nodejs.org/en/docs/inspector',
    'Debugger attached.',
    'listening on 4100',
    'Error: connect ECONNREFUSED',
  ].join('\n')
  // Act
  const result = withoutInspectorBanner(tail)
  // Assert
  assert.equal(result, 'listening on 4100\nError: connect ECONNREFUSED')
})

// Value: protects=D33 empty tail: a tail of only banner lines is empty so the view carries no outputTail; fails_when=a blank string reaches the view; no_claim=a real Node process
test('an output tail of only the inspector banner becomes empty', () => {
  // Arrange
  const tail =
    'Debugger listening on ws://127.0.0.1:9229/abc\nDebugger attached.\n'
  // Act
  const result = withoutInspectorBanner(tail)
  // Assert
  assert.equal(result, '')
})
