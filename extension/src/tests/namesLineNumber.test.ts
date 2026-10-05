import assert from 'node:assert/strict'
import { test } from 'node:test'

import { namesLineNumber } from '../utils/namesLineNumber'

// Value: protects=the one check of a moved stop's first interpretation reading the paused line's number as a number of its own; fails_when=digits inside a longer number count, or full-width digits do not; why_new=Cycle 0045 cause 1 (ER-5: compared after NFKC normalisation, not inside a longer number); seam=none
test('a text names a line when it holds the line’s number in ASCII or full-width digits, and not when the digits are part of a longer number', () => {
  // Arrange
  const line = 23

  // Act
  const inSentence = namesLineNumber('The action pauses on line 23.', line),
    afterColon = namesLineNumber('src/mode.ts:23 holds the call.', line),
    inFullWidthDigits = namesLineNumber('２３行目で停止しました。', line),
    insideLongerNumbers = namesLineNumber(
      'The value is 123 after 230 ms, in 2023.',
      line,
    ),
    declaredLineOnly = namesLineNumber('The action pauses on line 22.', line)

  // Assert
  assert.equal(inSentence, true)
  assert.equal(afterColon, true)
  assert.equal(inFullWidthDigits, true)
  assert.equal(insideLongerNumbers, false)
  assert.equal(declaredLineOnly, false)
})

// The documented limit: the check reads a number in prose and is no proof of the place.
test('a text that gives another line as the place and the line’s number as a value counts as naming the line, and a spelled-out numeral does not', () => {
  // Arrange
  const line = 23

  // Act
  const numberAsValue = namesLineNumber(
      'The stop paused on line 22 with the value 23.',
      line,
    ),
    inWords = namesLineNumber('The stop paused on line twenty-three.', line),
    inKanjiNumerals = namesLineNumber('二十三行目で停止しました。', line)

  // Assert
  assert.equal(numberAsValue, true)
  assert.equal(inWords, false)
  assert.equal(inKanjiNumerals, false)
})
