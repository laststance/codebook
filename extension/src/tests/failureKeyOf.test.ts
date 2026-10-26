import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failureKeyOf } from '../utils/failureKeyOf'

// Value: protects=F10 (the key tells an Error with a code, one without, an object and a thrown string apart); fails_when=a code is dropped, an Error and a thrown string with the same text share a key, or an object prints as its message; no_claim=the Output wording; seam=none
test('the failure key tells an Error with a code, an Error without one, an object and a string apart', () => {
  // Arrange
  const withCode = Object.assign(new Error('busy'), { code: 'EBUSY' })
  const withoutCode = new TypeError('busy')

  // Act
  const keys = [
    failureKeyOf(withCode),
    failureKeyOf(withoutCode),
    failureKeyOf({ reason: 'busy' }),
    failureKeyOf('busy'),
  ]

  // Assert
  assert.deepEqual(keys, [
    'Error|EBUSY|busy',
    'TypeError||busy',
    "{ reason: 'busy' }",
    "'busy'",
  ])
})

// Value: protects=F5 (a changing number does not make a new failure, a changing code does); fails_when=digit runs stay in the key (every tick looks new), or the code is normalised away; no_claim=other punctuation in the message; seam=none
test('the failure key ignores the numbers of a message and keeps the error code', () => {
  // Arrange
  const earlier = Object.assign(new Error('pid 4711 gone after 30 ms'), {
    code: 'EBUSY',
  })
  const later = Object.assign(new Error('pid 52 gone after 60 ms'), {
    code: 'EBUSY',
  })
  const otherCode = Object.assign(new Error('pid 52 gone after 60 ms'), {
    code: 'EIO',
  })

  // Act
  const keys = [
    failureKeyOf(earlier),
    failureKeyOf(later),
    failureKeyOf(otherCode),
  ]

  // Assert
  assert.deepEqual(keys, [
    'Error|EBUSY|pid # gone after # ms',
    'Error|EBUSY|pid # gone after # ms',
    'Error|EIO|pid # gone after # ms',
  ])
})

// Value: protects=F5 (the cause one level down is part of the key, and the key is bounded); fails_when=two failures that differ in their cause share a key, or a long dump is kept whole; no_claim=a cause deeper than one level; seam=an Error with an Error cause, a very long message, a very long object
test('the failure key includes the cause one level down and is cut at 500 characters', () => {
  // Arrange
  const withCause = new Error('read failed', {
    cause: Object.assign(new Error('socket 7 closed'), { code: 'ECONNRESET' }),
  })
  const longMessage = new Error('x'.repeat(2_000))
  const longObject = { text: 'y'.repeat(2_000) }

  // Act
  const results = [
    failureKeyOf(withCause),
    failureKeyOf(longMessage).length,
    failureKeyOf(longObject).length,
  ]

  // Assert
  assert.deepEqual(results, [
    'Error||read failed<-Error|ECONNRESET|socket # closed',
    500,
    500,
  ])
})

// Value: protects=F4 (a cause that cannot be read still has a key); fails_when=a message getter that throws makes the key throw; no_claim=the key of a readable cause; seam=an Error whose message getter throws
test('the failure key of a cause whose message cannot be read is its type tag', () => {
  // Arrange
  const hostile = new Error('hidden')
  Object.defineProperty(hostile, 'message', {
    get(): never {
      throw new Error('getter failed')
    },
  })

  // Act
  const key = failureKeyOf(hostile)

  // Assert
  assert.equal(key, '[object Error]')
})
