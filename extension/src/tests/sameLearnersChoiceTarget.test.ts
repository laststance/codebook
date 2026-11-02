import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  sameLearnersChoiceTarget,
  type LearnersChoice,
} from '../utils/sameLearnersChoiceTarget'

/**
 * A text file the learner picked, as far as {@link sameLearnersChoiceTarget} reads it: only its URI.
 * @param column - The view column of the group the file was picked in.
 * @param uri - The file's URI text.
 * @returns A pick of that file in that group.
 * @example textPick(4, 'file:///repository/data.ts') // => { column: 4, document: … }
 */
function textPick(column: number, uri: string): LearnersChoice {
  // The editor's document object has far more members than the comparison reads; the test needs only its URI.
  const document = {
    uri: { toString: () => uri },
  } as LearnersChoice['document']
  return { column, document }
}

// Value: protects=the return's own corrective re-show of a learner's pick is left out of the picks, so only a newer pick makes the return show again; fails_when=the same file in the same group is told apart from itself and the re-show is recorded as a new pick; why_new=Cycle 0072 task 1 candidate Codex review of af968024 (P2 2, the comparison of text picks); seam=none; no_claim=the watch that records the picks (studyWorkspaceLeftoverGroups.test)
test('a pick of the same file in the same group is the same target', () => {
  // Arrange
  const first = textPick(4, 'file:///repository/data.ts')
  const second = textPick(4, 'file:///repository/data.ts')
  // Act
  const same = sameLearnersChoiceTarget(first, second)
  // Assert
  assert.equal(same, true)
})

// Value: protects=a learner's pick of a file that is open in two groups stays a pick of its own when the return's re-show of the pick in the first group is pending; fails_when=text picks are compared by URI alone, so the pick in the second group is dropped as the re-show's effect and the keyboard goes back to the first group; why_new=Cycle 0072 task 1 candidate Codex review of af968024 (P2 2); seam=none; no_claim=the watch that records the picks (studyWorkspaceLeftoverGroups.test)
test('a pick of the same file in another group is another target', () => {
  // Arrange
  const inFirstGroup = textPick(4, 'file:///repository/data.ts')
  const inSecondGroup = textPick(5, 'file:///repository/data.ts')
  // Act
  const same = sameLearnersChoiceTarget(inFirstGroup, inSecondGroup)
  // Assert
  assert.equal(same, false)
})

// Value: protects=a pick of another file in the same group is a newer pick, not the re-show of the first one; fails_when=picks in one group are all taken as one target and the newer file is lost; why_new=Cycle 0072 task 1 candidate Codex review of af968024 (P2 2); seam=none; no_claim=none
test('a pick of another file in the same group is another target', () => {
  // Arrange
  const dataTs = textPick(4, 'file:///repository/data.ts')
  const searchTsx = textPick(4, 'file:///repository/search.tsx')
  // Act
  const same = sameLearnersChoiceTarget(dataTs, searchTsx)
  // Assert
  assert.equal(same, false)
})
