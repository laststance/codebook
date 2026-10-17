import assert from 'node:assert/strict'
import { test } from 'node:test'

import { textEditorColumn } from '../utils/textEditorColumn'

/** A diff editor's tab input, as the editor API's `TabInputTextDiff`. */
class TextDiffInput {
  constructor(
    readonly original: string,
    readonly modified: string,
  ) {}
}
/** A text editor's tab input, as the editor API's `TabInputText`. */
class TextInput {
  constructor(readonly uri: string) {}
}

/** A text editor as both editors report it: a plain one with its column, a side of a diff with none (C61 c61-688-diffprobe). */
const editorOf = (uri: string, viewColumn?: number) => ({
  viewColumn,
  document: { uri: { toString: () => uri } },
})

// Value: protects=the proof and the give-back of a learner's diff editor: both editors report its sides with no view column, so the side's column is the one group that shows its document in a diff in front, while a plain text editor keeps its own; fails_when=a diff's side without a view column is placed nowhere, so a layout read beside another editor part borrows the first group and cannot give the keyboard back (C61 c61-cu-688); why_new=Cycle 0046 row 709; seam=none
test('a diff side without a view column is placed in the group that shows its diff in front, and a plain text editor in its own column', () => {
  // Arrange
  const groups = [
    {
      viewColumn: 1,
      activeTab: { input: new TextInput('file:///r/login-form.tsx') },
    },
    {
      viewColumn: 2,
      activeTab: {
        input: new TextDiffInput('git:/r/auth.ts', 'file:///r/auth.ts'),
      },
    },
  ]

  // Act
  const columns = {
    modifiedSide: textEditorColumn(
      editorOf('file:///r/auth.ts'),
      groups,
      TextDiffInput,
    ),
    originalSide: textEditorColumn(
      editorOf('git:/r/auth.ts'),
      groups,
      TextDiffInput,
    ),
    plain: textEditorColumn(
      editorOf('file:///r/login-form.tsx', 1),
      groups,
      TextDiffInput,
    ),
    noEditor: textEditorColumn(undefined, groups, TextDiffInput),
  }

  // Assert
  assert.deepEqual(columns, {
    modifiedSide: 2,
    originalSide: 2,
    plain: 1,
    noEditor: undefined,
  })
})

// Value: protects=the bound of that placement: a diff side is placed only in a counted column and only when one group shows its diff in front, so a diff in another part's group (VS Code's floating window) or in two groups proves nothing; fails_when=any group that shows the diff places the side, so a diff beyond the measured main editor proves the main editor active or a borrow gives the keyboard to a guessed group; why_new=Cycle 0046 row 709 (the bound of its fix); seam=none
test('a diff side is placed nowhere when its diff stands only beyond the counted columns, in two groups, or nowhere', () => {
  // Arrange
  const diff = () => ({
    input: new TextDiffInput('git:/r/auth.ts', 'file:///r/auth.ts'),
  })
  const side = editorOf('file:///r/auth.ts')

  // Act
  const columns = {
    beyondCount: textEditorColumn(
      side,
      [
        {
          viewColumn: 1,
          activeTab: { input: new TextInput('file:///r/a.ts') },
        },
        { viewColumn: 3, activeTab: diff() },
      ],
      TextDiffInput,
      2,
    ),
    twoGroups: textEditorColumn(
      side,
      [
        { viewColumn: 1, activeTab: diff() },
        { viewColumn: 2, activeTab: diff() },
      ],
      TextDiffInput,
    ),
    behindAnotherTab: textEditorColumn(
      side,
      [
        {
          viewColumn: 1,
          activeTab: { input: new TextInput('file:///r/auth.ts') },
        },
      ],
      TextDiffInput,
    ),
    hostWithoutDiffs: textEditorColumn(
      side,
      [{ viewColumn: 1, activeTab: diff() }],
      undefined,
    ),
  }

  // Assert
  assert.deepEqual(columns, {
    beyondCount: undefined,
    twoGroups: undefined,
    behindAnotherTab: undefined,
    hostWithoutDiffs: undefined,
  })
})
