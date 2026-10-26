import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeOutputFolderWithoutWiki } from '../utils/describeOutputFolderWithoutWiki'

// Value: protects=the learner whose output folder exists without a Wiki (an empty folder made beforehand, a failed generation's leftover); fails_when=the refusal names no folder, suggests that Codebook clears the learner's files, or gives no way on; no_claim=when it is shown (startWikiRun tests); seam=none
test('the refusal of an existing folder without a Wiki names the folder, leaves its files to the learner and gives the two ways on', () => {
  // Act
  const sentence = describeOutputFolderWithoutWiki('docs/wiki')

  // Assert
  assert.equal(
    sentence,
    'The folder docs/wiki already exists but holds no LLM Wiki, and the publisher writes a first Wiki only into a folder it makes itself. Move what you keep in it elsewhere and remove the folder, or set codebook.wikiOutputDirectory to a folder that does not exist yet, then press Generate LLM Wiki again.',
  )
})
