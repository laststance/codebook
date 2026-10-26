import assert from 'node:assert/strict'
import { test } from 'node:test'

import { systemErrorCode } from '../utils/systemErrorCode'

// Value: protects=F9 (an own code of undefined or null is no code); fails_when=an Error with code undefined or null reads as the text 'undefined' or 'null', which then shows in "cannot be read (undefined)" and in failure keys; no_claim=the callers' branches (their own tests); seam=none
test('the system error code is the text of a string or number code and empty for any other failure', () => {
  // Arrange
  const withText = Object.assign(new Error('kill'), { code: 'ESRCH' })
  const withNumber = Object.assign(new Error('exit'), { code: 3 })
  const withUndefined = Object.assign(new Error('odd'), { code: undefined })
  const withNull = Object.assign(new Error('odd'), { code: null })
  const withoutCode = new Error('plain')
  const notAnError = { code: 'EBUSY' }

  // Act
  const codes = [
    systemErrorCode(withText),
    systemErrorCode(withNumber),
    systemErrorCode(withUndefined),
    systemErrorCode(withNull),
    systemErrorCode(withoutCode),
    systemErrorCode(notAnError),
  ]

  // Assert
  assert.deepEqual(codes, ['ESRCH', '3', '', '', '', ''])
})
