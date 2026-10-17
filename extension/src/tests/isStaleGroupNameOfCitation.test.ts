import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isStaleGroupNameOfCitation } from '../utils/isStaleGroupNameOfCitation'

// Value: protects=the Repository Wiki's cold open from Cursor's chat, whose citation takes the keyboard in the first group while Cursor goes on naming the chat part's group (row 660); fails_when=that unchanged name of the chat's group is not taken for the citation's group, so the open is refused as a learner's change; why_new=Cycle 0046 row 660; seam=none
test('the chat part’s group Cursor still names while the citation is in front of the first group stands for the citation’s group', () => {
  // Arrange
  const columns = { namedBefore: 3, namedNow: 3, citation: 1 }

  // Act
  const stale = isStaleGroupNameOfCitation(columns, true)

  // Assert
  assert.equal(stale, true)
})

// Value: protects=the learner's newer choice during a cold Wiki open: a name that changed, a citation not in front, and a first group that was named before are never taken for the citation's stale name; fails_when=the stale name forgives a learner's change of group or a missing citation; why_new=Cycle 0046 row 660 (its bound); seam=none
test('a changed name, a citation not in front, and the citation’s own group named before are no stale name of the citation', () => {
  // Arrange
  const cases = [
    { columns: { namedBefore: 3, namedNow: 2, citation: 1 }, inFront: true },
    { columns: { namedBefore: 3, namedNow: 3, citation: 1 }, inFront: false },
    { columns: { namedBefore: 1, namedNow: 1, citation: 1 }, inFront: true },
  ]

  // Act
  const answers = cases.map(({ columns, inFront }) =>
    isStaleGroupNameOfCitation(columns, inFront),
  )

  // Assert
  assert.deepEqual(answers, [false, false, false])
})
