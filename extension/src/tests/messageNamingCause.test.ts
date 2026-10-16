import assert from 'node:assert/strict'
import { test } from 'node:test'

import { messageNamingCause } from '../utils/messageNamingCause'

// Value: protects=the failure sentence of a run that failed with an error that is no StudyError naming that error's words after the generic sentence, without the error's class name; fails_when=the sentence stays "The study operation failed." or carries "Error: " in front of the cause; why_new=Cycle 0046 row 645; seam=none
test('a generic failure sentence names the cause after it, without the error name', () => {
  // Arrange
  const message = 'The study operation failed.',
    cause = 'Error: The dedicated Application layout could not be confirmed.'

  // Act
  const named = messageNamingCause(message, cause)

  // Assert
  assert.equal(
    named,
    'The study operation failed. Cause: The dedicated Application layout could not be confirmed.',
  )
})

// Value: protects=sentences that already say why a run failed staying as they are; fails_when=a cause equal to the sentence, or quoted inside it, is appended a second time; why_new=Cycle 0046 row 645; seam=none
test('a failure sentence that is its own cause or already quotes the cause stays as it is', () => {
  // Arrange
  const ownCause = 'Configured source binding is absent.',
    quoting =
      'The study library could not be read, so no run was started: disk full. Repair or remove the entry it names in the learning library, then start again. Existing learning was kept.'

  // Act
  const unchanged = messageNamingCause(ownCause, ownCause),
    quoted = messageNamingCause(quoting, 'Error: disk full')

  // Assert
  assert.equal(unchanged, 'Configured source binding is absent.')
  assert.equal(quoted, quoting)
})

// Value: protects=the saved study's reason limit holding for a cause of any length; fails_when=a long cause makes the sentence longer than the 8,192 characters a saved reason may hold; why_new=Cycle 0046 row 645; seam=none
test('a failure sentence that names a long cause is cut to the saved reason limit', () => {
  // Arrange
  const cause = `Error: ${'x'.repeat(10_000)}`

  // Act
  const named = messageNamingCause('The study operation failed.', cause)

  // Assert
  assert.equal(named.length, 8_192)
  assert.equal(named.startsWith('The study operation failed. Cause: xxx'), true)
})
