import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adoptWikiGroupReturn } from '../utils/adoptWikiGroupReturn'

// Value: protects=the ordinary Wiki command right after Study Close, whose acquired source keeps the keyboard while the editor selects the Wiki's group again; fails_when=that return is not taken into the retained focus, so the reader refuses it as newer learner input; why_new=Cycle 0046 row 444 (C24 capture 223); seam=none
test('a return to the Wiki group beside the same text editor becomes the retained focus', () => {
  // Arrange
  const source = {
    editor:
      '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
    group: '[1,"module.ts"]',
  }
  const wikiGroup = {
    editor:
      '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
    group: '[2,"codebook · Repository Wiki"]',
  }

  // Act
  const retained = adoptWikiGroupReturn(source, wikiGroup, true)

  // Assert
  assert.deepEqual(retained, {
    editor:
      '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
    group: '[2,"codebook · Repository Wiki"]',
  })
})

// Value: protects=newer learner input during Wiki navigation; fails_when=a moved caret, another editor, keyboard taken into the Wiki or another group is taken into the retained focus and the old navigation overrides it; why_new=Cycle 0046 row 444 (the bound of the accepted return); seam=none
test('a changed text editor, a group that is not the Wiki beside a text editor, or an unestablished focus stays as it was', () => {
  // Arrange
  const source = {
    editor:
      '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
    group: '[1,"module.ts"]',
  }
  const movedCaret = {
    editor:
      '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1,"moved"]',
    group: '[2,"codebook · Repository Wiki"]',
  }
  const otherGroup = {
    editor:
      '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
    group: '[3,"draft.txt"]',
  }

  // Act
  const results = [
    adoptWikiGroupReturn(source, movedCaret, true),
    adoptWikiGroupReturn(source, otherGroup, false),
    adoptWikiGroupReturn(undefined, otherGroup, true),
    adoptWikiGroupReturn(source, source, true),
  ]

  // Assert
  assert.deepEqual(results, [
    {
      editor:
        '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
      group: '[1,"module.ts"]',
    },
    {
      editor:
        '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
      group: '[1,"module.ts"]',
    },
    undefined,
    {
      editor:
        '["codebook-repository-source://w/architecture/1/module/0/module.ts",1,1]',
      group: '[1,"module.ts"]',
    },
  ])
})
