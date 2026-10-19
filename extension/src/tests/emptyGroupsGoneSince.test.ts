import assert from 'node:assert/strict'
import { test } from 'node:test'

import { emptyGroupsGoneSince } from '../utils/emptyGroupsGoneSince'

// Value: protects=the Close's give-back of the learner's groups on row 639's path: the earlier window's empty leftover group in front of the learner's groups is gone (the editor removed it when the Application left it), and the learner's groups still count as theirs, with that leftover's index named so the layout leaves it out; fails_when=any group fewer than noted counts as another arrangement, so Close gives nothing back and the learner's stacked groups stay side by side; why_new=Cycle 0046 row 639; seam=none
test('an empty group of before that is gone in front of the learner’s groups is named, and the learner’s groups still count as theirs', () => {
  // Arrange: the leftover row in front of actions.ts and auth.ts, which gained a debugger file.
  const before = [[], ['actions.ts'], ['auth.ts']]
  const now = [['actions.ts', 'paused.ts'], ['auth.ts']]

  // Act
  const gone = emptyGroupsGoneSince(before, now)

  // Assert
  assert.deepEqual(gone, [0])
})

// Value: protects=the existing comparison of the learner's groups at Close: the same groups name no gap, an empty group removed at the end is no gap either (the layout makes it again), and an empty group that stands is matched; fails_when=a group that stands counts as gone, so the layout leaves a learner's group out; why_new=Cycle 0046 row 639 (what stays as before); seam=none
test('the same groups, an empty group removed at the end and an empty group that stands name no gap', () => {
  // Arrange
  const sameGroups = emptyGroupsGoneSince(
    [['actions.ts'], ['auth.ts']],
    [['actions.ts'], ['auth.ts']],
  )
  const removedAtTheEnd = emptyGroupsGoneSince(
    [['actions.ts'], []],
    [['actions.ts']],
  )
  const emptyThatStands = emptyGroupsGoneSince(
    [[], ['actions.ts']],
    [[], ['actions.ts']],
  )

  // Act
  const results = [sameGroups, removedAtTheEnd, emptyThatStands]

  // Assert
  assert.deepEqual(results, [[], [], []])
})

// Value: protects=the learner's own arrangement made during the session: a group opened, a group with tabs closed or moved, or a tab of before closed, keeps what the learner made, and no layout of before is applied; fails_when=such a change counts as the learner's groups of before, so Close merges or moves the learner's new arrangement; why_new=Cycle 0046 row 639 (the bounds of the give-back); seam=none
test('a group opened, a group with tabs closed or moved, or a tab of before closed is another arrangement', () => {
  // Arrange
  const opened = emptyGroupsGoneSince(
    [['actions.ts']],
    [['actions.ts'], ['notes.md']],
  )
  const closedWithTabs = emptyGroupsGoneSince(
    [['actions.ts'], ['auth.ts']],
    [['auth.ts']],
  )
  const moved = emptyGroupsGoneSince(
    [['actions.ts'], ['auth.ts']],
    [['auth.ts'], ['actions.ts']],
  )
  const tabClosed = emptyGroupsGoneSince(
    [['actions.ts', 'login-form.tsx'], ['auth.ts']],
    [['actions.ts'], ['auth.ts']],
  )

  // Act
  const results = [opened, closedWithTabs, moved, tabClosed]

  // Assert
  assert.deepEqual(results, [undefined, undefined, undefined, undefined])
})
