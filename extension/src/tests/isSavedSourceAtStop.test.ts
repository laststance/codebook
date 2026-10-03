import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSavedSourceAtStop } from '../utils/isSavedSourceAtStop'

/** The stop of every case: declared at 22:3 with a citation that ends on line 30. */
const declared = { line: 22, column: 3 },
  citation = { endLine: 30 }

// Value: protects=a saved observation at its declared position staying valid without any native debugger state, as before a later line could be accepted; fails_when=the declared position needs the debugger state, or is refused without a citation; why_new=the predicate is new (Cycle 0043, ER8); seam=none
test('a saved observation at its declared position is at its stop, with or without saved debugger state', () => {
  // Act
  const answers = [
    isSavedSourceAtStop({ line: 22, column: 3 }, false, declared, citation),
    isSavedSourceAtStop({ line: 22, column: 3 }, true, declared, citation),
    isSavedSourceAtStop({ line: 22, column: 3 }, false, declared, undefined),
  ]
  // Assert
  assert.deepEqual(answers, [true, true, true])
})

// Value: protects=a position the debugger chose (another column, or a later line within the citation) counting only when the saved native frame can confirm it; fails_when=a moved position is accepted without debugger state, or refused with it; why_new=the predicate is new (Cycle 0043, ER8); seam=none
test('a saved observation at another column or on a later line within the citation is at its stop only with saved debugger state', () => {
  // Act
  const withState = [
      isSavedSourceAtStop({ line: 22, column: 9 }, true, declared, citation),
      isSavedSourceAtStop({ line: 23, column: 5 }, true, declared, citation),
      isSavedSourceAtStop({ line: 30, column: 1 }, true, declared, citation),
    ],
    withoutState = [
      isSavedSourceAtStop({ line: 22, column: 9 }, false, declared, citation),
      isSavedSourceAtStop({ line: 23, column: 5 }, false, declared, citation),
    ]
  // Assert
  assert.deepEqual(withState, [true, true, true])
  assert.deepEqual(withoutState, [false, false])
})

// Value: protects=a saved observation never being accepted before its declared line or outside what its article shows; fails_when=an earlier line, a line after the citation, or any other line without a citation is accepted; why_new=the predicate is new (Cycle 0043, ER8); seam=none
test('a saved observation on an earlier line, after the citation or on another line of a stop without a citation is not at its stop', () => {
  // Act
  const answers = [
    isSavedSourceAtStop({ line: 21, column: 3 }, true, declared, citation),
    isSavedSourceAtStop({ line: 31, column: 1 }, true, declared, citation),
    isSavedSourceAtStop({ line: 23, column: 5 }, true, declared, undefined),
  ]
  // Assert
  assert.deepEqual(answers, [false, false, false])
})
