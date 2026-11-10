import assert from 'node:assert/strict'
import { test } from 'node:test'

import { leftoverRemovalLine } from '../utils/leftoverRemovalLine'

// Value: protects=the Output line after a seen leftover removal names the column, the group count before the close and the removal's delay; fails_when=a number is missing, swapped or the line names a path or label; no_claim=that the extension writes the line at the close (the workspace harness covers the call).
test('the leftover removal line names the column, the groups before the close and the delay of a seen removal', () => {
  // Arrange
  const outcome = { seenAfterMs: 140 }

  // Act
  const line = leftoverRemovalLine(2, 3, outcome)

  // Assert
  assert.equal(
    line,
    'Leftover Application group: closed column 2 of 3 groups; removal seen after 140 ms',
  )
})

// Value: protects=the Output line after a missed leftover removal names the bound that passed and the group count at that moment beside the count before the close, so a recurrence tells a removal that never came from a disturbed count; fails_when=the bound or the count at the end is missing, or the count before the close stands where the count at the end belongs; no_claim=which cause the counts point to (E1 decides that).
test('the leftover removal line names the bound and the group count when no removal was seen', () => {
  // Arrange
  const outcome = { boundMs: 5000, groupsNow: 4 }

  // Act
  const line = leftoverRemovalLine(2, 3, outcome)

  // Assert
  assert.equal(
    line,
    'Leftover Application group: closed column 2 of 3 groups; removal not seen within 5000 ms (groups now 4)',
  )
})
