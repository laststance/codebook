import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withHomeFolderShown } from '../utils/withHomeFolderShown'

// Value: protects=Copy details hiding the learner's account; fails_when=the home folder stays in the copied sentence; no_claim=Windows spellings; seam=the pure function
test('the home folder in a copied sentence reads ~', () => {
  // Arrange
  const sentence = 'Edited /Users/ada/repo/a.html and /Users/ada/b.md'

  // Act
  const copied = withHomeFolderShown(sentence, '/Users/ada')

  // Assert
  assert.equal(copied, 'Edited ~/repo/a.html and ~/b.md')
})

// Value: protects=the copied text when the home is a root or empty; fails_when=every slash of the sentence becomes ~ or the text is interleaved with ~; no_claim=how such a home arises; seam=the pure function
test('a home folder that is / or empty leaves the copied sentence as it is', () => {
  // Arrange
  const sentence = 'Edited /repo/a.html'

  // Act
  const copied = [
    withHomeFolderShown(sentence, '/'),
    withHomeFolderShown(sentence, ''),
  ]

  // Assert
  assert.deepEqual(copied, [sentence, sentence])
})

// Value: protects=the account name of a neighbour folder and of the learner in Copy details; fails_when=a folder whose name starts with the home's name is cut to ~ plus its tail, or the home before a closing quote, bracket or full stop stays; no_claim=Windows spellings; seam=the pure function; why_new=the first test only has paths below the home
test('a sibling folder that starts with the home name stays whole and a home before a quote or full stop is hidden', () => {
  // Arrange
  const sentence =
    'Edited /Users/adam/x and "/Users/ada" and (/Users/ada) and /Users/ada.'

  // Act
  const copied = withHomeFolderShown(sentence, '/Users/ada', 'darwin')

  // Assert
  assert.equal(copied, 'Edited /Users/adam/x and "~" and (~) and ~.')
})

// Value: protects=the account name in Copy details on Windows; fails_when=a home spelled with another drive letter case or with / instead of \ stays in the copied text, or a sibling folder is cut; no_claim=a real Windows host; seam=the pure function with the platform passed in; why_new=the other tests use POSIX paths
test('on Windows the home folder reads ~ whatever the drive letter case and separator, and a sibling folder stays whole', () => {
  // Arrange
  const sentence =
    'Edited c:\\users\\ADA\\repo\\a.html and C:/Users/ada/b.md and C:\\Users\\adam\\c.md'

  // Act
  const copied = withHomeFolderShown(sentence, 'C:\\Users\\ada', 'win32')

  // Assert
  assert.equal(
    copied,
    'Edited ~\\repo\\a.html and ~/b.md and C:\\Users\\adam\\c.md',
  )
})
