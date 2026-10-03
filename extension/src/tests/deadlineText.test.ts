import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deadlineText } from '../utils/deadlineText'

// Value: protects=a progress deadline always failing its run, also when the text it composes at expiry throws; fails_when=the reason function's error escapes the timer and the run never fails; why_new=Cycle 0043 R17; seam=none
test('a deadline whose failure text throws while it is composed still gives a text that names the deadline and the thrown message', () => {
  // Arrange
  const throwingReason = (): string => {
    throw new Error('debug session ended')
  }
  // Act
  const text = deadlineText(throwingReason, 20_000)
  // Assert
  assert.equal(
    text,
    'Repository run made no progress within 20 s; its failure text could not be composed: debug session ended',
  )
})

// Value: protects=the deadline texts agents read staying exactly what the run composed; fails_when=a string reason or a composed text is changed; why_new=Cycle 0043 R17; seam=none
test('a deadline text given as a string or composed without error is used unchanged', () => {
  // Arrange
  const composedReason = (): string =>
    'Repository input reached no verified pause'
  // Act
  const texts = [
    deadlineText('after timed out', 20_000),
    deadlineText(composedReason, 20_000),
  ]
  // Assert
  assert.deepEqual(texts, [
    'after timed out',
    'Repository input reached no verified pause',
  ])
})
