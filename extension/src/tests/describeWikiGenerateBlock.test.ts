import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiGenerateBlock } from '../utils/describeWikiGenerateBlock'

// Value: protects=D5 and the publisher's refusals before a first generation, and a learner who never reads a raw cause id in a sentence (Cycle 0056 task 10); fails_when=a block a folder without a manifest can hold is told with an update's words, names no path, names no next step, or a block that needs a manifest shows its cause id such as edited-page; no_claim=finding the block (findWikiUpdateStartBlock tests); seam=none
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
    'The folder .codebook/wiki cannot take a new LLM Wiki: index.html is in the way. Press Update LLM Wiki to see what it is.',
  ])
})

// Value: protects=Cycle 0056 L5, a block that needs a manifest and names no path; fails_when=the sentence says the folder is in its own way ("X cannot take a new LLM Wiki: X is in the way"); no_claim=a block that names a path (test above); seam=none
test('a block that needs a manifest and names no path does not call the folder itself the thing in the way', () => {
  // Act
  const sentence = describeWikiGenerateBlock(
    { cause: 'edited-page', paths: [] },
    '.codebook/wiki',
  )

  // Assert
  assert.equal(
    sentence,
    'The folder .codebook/wiki cannot take a new LLM Wiki. Press Update LLM Wiki to see what is in the way.',
  )
})
