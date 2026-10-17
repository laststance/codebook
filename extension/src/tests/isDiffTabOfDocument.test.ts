import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDiffTabOfDocument } from '../utils/isDiffTabOfDocument'

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

// Value: protects=a learner's diff editor beside another editor part: the diff in front of a group shows the active text editor's document on either side, which proves the main editor as a plain text tab does; fails_when=only a plain text tab counts, so a layout read borrows the first group and gives the keyboard back with showTextDocument, which opens a plain text tab in front of the diff; why_new=Cycle 0046 row 688; seam=none
test("a diff editor's tab shows the document of either of its sides", () => {
  // Arrange
  const diff = new TextDiffInput(
    'git:/repository/auth.ts',
    'file:///repository/auth.ts',
  )

  // Act
  const answers = {
    modified: isDiffTabOfDocument(
      diff,
      'file:///repository/auth.ts',
      TextDiffInput,
    ),
    original: isDiffTabOfDocument(
      diff,
      'git:/repository/auth.ts',
      TextDiffInput,
    ),
  }

  // Assert
  assert.deepEqual(answers, { modified: true, original: true })
})

// Value: protects=the bound of the diff's proof: another document, a plain text tab and a host without the diff class prove nothing through this check; fails_when=a diff of another file, or any tab in a host without the class, is read as the active text editor's diff; why_new=Cycle 0046 row 688 (its bound); seam=none
test('a diff of another document, a plain text tab and a host without the diff class are no diff tab of the document', () => {
  // Arrange
  const diff = new TextDiffInput(
    'git:/repository/auth.ts',
    'file:///repository/auth.ts',
  )

  // Act
  const answers = {
    anotherDocument: isDiffTabOfDocument(
      diff,
      'file:///repository/notes.ts',
      TextDiffInput,
    ),
    textTab: isDiffTabOfDocument(
      new TextInput('file:///repository/auth.ts'),
      'file:///repository/auth.ts',
      TextDiffInput,
    ),
    withoutClass: isDiffTabOfDocument(
      diff,
      'file:///repository/auth.ts',
      undefined,
    ),
  }

  // Assert
  assert.deepEqual(answers, {
    anotherDocument: false,
    textTab: false,
    withoutClass: false,
  })
})
