import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiGenerateBlock } from '../utils/describeWikiGenerateBlock'

// Value: protects=D5 and the publisher's refusals before a first generation; fails_when=a block a folder without a manifest can hold is told with an update's words, names no path, or names no next step; no_claim=finding the block (findWikiUpdateStartBlock tests); seam=none
test('each block a folder without a Wiki can hold is told with the generation’s next step, and a block that needs a manifest sends the learner to the update', () => {
  // Act
  const sentences = [
    describeWikiGenerateBlock(
      { cause: 'unfinished-publish', paths: ['wiki.publish-journal.json'] },
      '.codebook/wiki',
    ),
    describeWikiGenerateBlock(
      { cause: 'not-a-folder', paths: ['wiki'] },
      '.codebook/wiki',
    ),
    describeWikiGenerateBlock(
      { cause: 'linked-parent', paths: ['.codebook'] },
      '.codebook/wiki',
    ),
    describeWikiGenerateBlock(
      { cause: 'special-file', paths: ['pipe'] },
      '.codebook/wiki',
    ),
    describeWikiGenerateBlock(
      { cause: 'edited-page', paths: ['index.html'] },
      '.codebook/wiki',
    ),
  ]

  // Assert
  assert.deepEqual(sentences, [
    'A publish of the LLM Wiki in .codebook/wiki may still be running or was stopped (wiki.publish-journal.json). Once it ends, press Generate LLM Wiki again; if it was stopped, ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project" once its process exits.',
    '.codebook/wiki is a link or a file, not a folder of its own, so the publisher cannot write the Wiki there. Remove it, or set codebook.wikiOutputDirectory to another folder, then press Generate LLM Wiki again.',
    'A folder on the path to .codebook/wiki (.codebook) is a link or a file, or leads out of the project, so the publisher refuses to write there. Replace it with a real folder, or set codebook.wikiOutputDirectory to another folder, then press Generate LLM Wiki again.',
    '.codebook/wiki holds a link or special file (pipe), which the publisher refuses. Move it out of the folder, then press Generate LLM Wiki again.',
    'The folder .codebook/wiki cannot take a new LLM Wiki (edited-page: index.html). Press Update LLM Wiki to see what is in the way.',
  ])
})
