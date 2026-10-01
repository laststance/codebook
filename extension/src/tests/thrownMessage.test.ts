import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { thrownMessage } from '../utils/thrownMessage'

// Value: protects=binding failures naming what happened instead of "Error: Error: ..."; fails_when=a thrown value from another module context is not recognised as an error and its string form, prefix included, is embedded; why_new=Cycle 0036 X7/X8/X13 (the failure texts are composed around a caught error); seam=none
test('an error thrown by a module loaded in another context yields its message without the Error prefix', () => {
  // Arrange: an Error of another realm is not an instance of this realm's Error.
  const foreign: unknown = runInNewContext(
    'new Error("Timed out waiting for a verified binding")',
  )
  // Act
  const message = thrownMessage(foreign)
  // Assert
  assert.equal(foreign instanceof Error, false)
  assert.equal(message, 'Timed out waiting for a verified binding')
})

test('an ordinary error yields its message and a thrown non-error yields its string form', () => {
  // Arrange / Act / Assert
  assert.equal(thrownMessage(new Error('late')), 'late')
  assert.equal(thrownMessage('late'), 'late')
  assert.equal(thrownMessage(undefined), 'undefined')
  assert.equal(thrownMessage({ message: 404 }), '[object Object]')
})
