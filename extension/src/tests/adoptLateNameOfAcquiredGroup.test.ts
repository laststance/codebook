import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adoptLateNameOfAcquiredGroup } from '../utils/adoptLateNameOfAcquiredGroup'

// Value: protects=a Wiki's cold open beside Cursor's chat part, whose receipt took the citation under Cursor's stale name of the chat's group: the editor naming the citation's own group later, with the same text editor, is followed once and is no learner change; fails_when=that late naming retires the navigation as the learner's newer focus ("Native focus changed during repository navigation; …", C58 c58-cu-2c); why_new=Cycle 0046 row 660 (the extraction that kept retainNativeFocus's observe under the measured health limits); seam=none
test('the late name of an acquired target’s own group is followed once and ends the stale-name acceptance', () => {
  // Arrange
  const retained = {
    editor: '["codebook-repository-source://w/a",1,1]',
    group: '[3,"New Agent"]',
  }
  const current = {
    editor: '["codebook-repository-source://w/a",1,1]',
    group: '[1,"module.ts"]',
  }
  const target = {
    matchesEditor: () => true,
    matchesGroup: () => true,
    namesStaleGroup: () => false,
  }

  // Act
  const followed = adoptLateNameOfAcquiredGroup(retained, current, target, true)

  // Assert
  assert.deepEqual(followed, {
    retained: {
      editor: '["codebook-repository-source://w/a",1,1]',
      group: '[1,"module.ts"]',
    },
    staleNameAccepted: false,
  })
})

// Value: protects=the learner's newer focus during a Wiki's navigation: another text editor, a target that still holds only through the stale name, and a receipt that took no stale name keep the retained focus, so the change still retires the navigation; fails_when=any change of the named group is followed as the editor's late naming; why_new=Cycle 0046 row 660; seam=none
test('another text editor, a still stale name and a receipt without one follow no late name', () => {
  // Arrange
  const retained = {
    editor: '["codebook-repository-source://w/a",1,1]',
    group: '[3,"New Agent"]',
  }
  const target = {
    matchesEditor: () => true,
    matchesGroup: () => true,
    namesStaleGroup: () => false,
  }
  const stillStale = { ...target, namesStaleGroup: () => true }

  // Act
  const answers = [
    adoptLateNameOfAcquiredGroup(
      retained,
      { editor: '["file:///w/login-form.tsx",1,1]', group: '[1,"login"]' },
      target,
      true,
    ),
    adoptLateNameOfAcquiredGroup(
      retained,
      { ...retained, group: '[1,"module.ts"]' },
      stillStale,
      true,
    ),
    adoptLateNameOfAcquiredGroup(
      retained,
      { ...retained, group: '[1,"module.ts"]' },
      target,
      false,
    ),
  ]

  // Assert
  assert.deepEqual(answers, [
    { retained, staleNameAccepted: true },
    { retained, staleNameAccepted: true },
    { retained, staleNameAccepted: false },
  ])
})
