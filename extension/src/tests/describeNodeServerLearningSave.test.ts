import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeServerLearningSave } from '../utils/describeNodeServerLearningSave'

// protects=the partial notice prints no terminal control or bidi override from the store's reason; fails_when=a color escape or the right-to-left override reaches the notice; no_claim=the store's own stripping
test('the partial notice strips controls from the reason', () => {
  // Arrange
  const firstReason = 'No response‮ was\u001b[31m recorded.'

  // Act
  const notice = describeNodeServerLearningSave({
    kind: 'partial',
    firstReason,
    moreCount: 1,
  })

  // Assert
  assert.equal(
    notice.text,
    'Server replay saved as partial: No response was recorded (+1 more).',
  )
})

// protects=a cause the seal already worded is shown as it is, and a bare cause gets the prefix once; fails_when=the prefix appears twice; no_claim=cause cutting
test('a seal failure already worded is not prefixed twice', () => {
  // Arrange
  const worded = 'Learning replay could not be saved: timed out after 10 s.'

  // Act
  const alreadyWorded = describeNodeServerLearningSave({
    kind: 'failed',
    cause: worded,
  })
  const bare = describeNodeServerLearningSave({
    kind: 'failed',
    cause: 'EROFS: read-only.',
  })

  // Assert
  assert.equal(alreadyWorded.text, worded)
  assert.equal(
    bare.text,
    'Learning replay could not be saved: EROFS: read-only.',
  )
})
