import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deepWikiOpenFailureNotice } from '../utils/deepWikiOpenFailureNotice'

// Value: protects=the Open DeepWiki failure notice of a reason that already ends its sentence, which the learner reads with one full stop before the next step; fails_when=the notice adds a full stop to every reason, so a reason ending with "." is shown with two ("..") before "Generate it through /codebook"; why_new=CR2-4; seam=none; no_claim=a reason ending with "!", "?" or "…" (only the full stop is read)
test('the Open DeepWiki failure notice shows a reason that ends with a full stop with that one full stop before the next step', () => {
  // Arrange
  const failure = new Error('The Wiki folder could not be read.')

  // Act
  const notice = deepWikiOpenFailureNotice(failure)

  // Assert
  assert.equal(
    notice,
    'Codebook could not open DeepWiki: Error: The Wiki folder could not be read. Generate it through /codebook in this project, then retry.',
  )
})

// Value: protects=the Open DeepWiki failure notice of a reason without a full stop, which still ends its sentence before the next step; fails_when=the fix for a reason that ends with "." drops the full stop of every reason, so the reason runs into "Generate it through /codebook"; why_new=CR2-4 (the other half); seam=none; no_claim=a path refusal (WikiPathRefusedError), whose own repair step ends the notice
test('the Open DeepWiki failure notice ends a reason without a full stop with one before the next step', () => {
  // Arrange
  const failure = new Error('Missing manifest')

  // Act
  const notice = deepWikiOpenFailureNotice(failure)

  // Assert
  assert.equal(
    notice,
    'Codebook could not open DeepWiki: Error: Missing manifest. Generate it through /codebook in this project, then retry.',
  )
})
