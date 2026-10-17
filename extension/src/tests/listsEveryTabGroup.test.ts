import assert from 'node:assert/strict'
import { test } from 'node:test'

import { listsEveryTabGroup } from '../utils/listsEveryTabGroup'

// Value: protects=the proof of which group Codebook's lock changed: the whole tab model both editors send for a lock that changed names the locked group as active (row 650); fails_when=that change is not recognized, so the reservation reads no proof and cannot tell the Application's own group from the learner's; why_new=Cycle 0046 row 650; seam=none
test('a change that lists every group of the tab model, with none opened or closed, is a whole tab model', () => {
  // Arrange
  const application = { viewColumn: 1 },
    learner = { viewColumn: 2 }

  // Act
  const whole = listsEveryTabGroup(
    { opened: [], closed: [], changed: [application, learner] },
    [application, learner],
  )

  // Assert
  assert.equal(whole, true)
})

// Value: protects=a learner's lock from being taken off: a group Cursor activates after the lock comes alone and must not be read as the group the lock changed (row 650); fails_when=a single activated group is taken for a whole tab model; why_new=Cycle 0046 row 650; seam=none
test('a group activated alone is no whole tab model', () => {
  // Arrange
  const application = { viewColumn: 1 },
    learner = { viewColumn: 2 }

  // Act
  const whole = listsEveryTabGroup(
    { opened: [], closed: [], changed: [learner] },
    [application, learner],
  )

  // Assert
  assert.equal(whole, false)
})

// Value: protects=the same proof from the editor's own change of the grid, which opens or closes a group and is no lock's; fails_when=a group's insertion or removal is read as a lock's tab model; why_new=Cycle 0046 row 650; seam=none
test('a change that opens or closes a group, and a tab model without groups, are no lock’s whole tab model', () => {
  // Arrange
  const application = { viewColumn: 1 },
    learner = { viewColumn: 2 }

  // Act
  const answers = [
    listsEveryTabGroup(
      { opened: [application], closed: [], changed: [learner] },
      [application, learner],
    ),
    listsEveryTabGroup(
      { opened: [], closed: [application], changed: [learner] },
      [learner],
    ),
    listsEveryTabGroup({ opened: [], closed: [], changed: [] }, []),
  ]

  // Assert
  assert.deepEqual(answers, [false, false, false])
})
