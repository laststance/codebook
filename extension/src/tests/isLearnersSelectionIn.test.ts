import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isLearnersSelectionIn } from '../utils/isLearnersSelectionIn'

// Value: protects=a Wiki's navigation from adopting the learner's own click or key in the active text editor as its citation, also when the selection matches the requested range; fails_when=the learner's mouse or keyboard selection is not recognized, so the navigation keeps a focus the learner changed; why_new=Cycle 0046 row 660 (the extraction from retainNativeFocus's observe); seam=none
test('a mouse or keyboard selection in the active text editor is the learner’s', () => {
  // Arrange
  const editor = {
    document: { uri: 'codebook-repository-source://w/module.ts' },
    viewColumn: 1,
  }

  // Act
  const answers = [
    isLearnersSelectionIn({ textEditor: editor, kind: 2 }, editor),
    isLearnersSelectionIn({ textEditor: editor, kind: 1 }, editor),
  ]

  // Assert
  assert.deepEqual(answers, [true, true])
})

// Value: protects=a Wiki's navigation from taking the editor's own jump, an extension's selection or another editor's selection for the learner's input; fails_when=a command's selection or one in another column retires the navigation; why_new=Cycle 0046 row 660; seam=none
test('a command’s selection, one in another column, and none at all are not the learner’s', () => {
  // Arrange
  const editor = {
    document: { uri: 'codebook-repository-source://w/module.ts' },
    viewColumn: 1,
  }
  const sameDocumentElsewhere = { ...editor, viewColumn: 2 }

  // Act
  const answers = [
    isLearnersSelectionIn({ textEditor: editor, kind: 3 }, editor),
    isLearnersSelectionIn(
      { textEditor: sameDocumentElsewhere, kind: 2 },
      editor,
    ),
    isLearnersSelectionIn(undefined, editor),
    isLearnersSelectionIn({ textEditor: editor, kind: 2 }, undefined),
  ]

  // Assert
  assert.deepEqual(answers, [false, false, false, false])
})
