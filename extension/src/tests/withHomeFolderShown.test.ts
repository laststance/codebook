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
