import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findGeneratedWikiProblem } from '../utils/findGeneratedWikiProblem'

// Value: protects=DX decision 54, what makes a new publication a Wiki the learner can open from this project; fails_when=a publication of another checkout or without its entry page is accepted, the owner is not checked first, a Wiki that passes both checks gets a problem, a manifest that cannot be read is told as another checkout's (local CodeRabbit, pt1), sending the learner to the setting instead of the recovery, or it passes as no problem, so a manifest read earlier and broken since ends as generated without its entry page checked (/ship Step 11, pt1); no_claim=the checks themselves (assertWikiOwner, readWikiFileToOpen tests); seam=stand-in checks
test('a generation’s publication is checked for its owner first, then its entry page, and passes when both hold; a manifest that cannot be read is no other checkout’s and gets the recovery request', async () => {
  // Arrange
  const fails = async (): Promise<void> => {
    throw new Error('refused')
  }
  const passes = async (): Promise<void> => {}
  const cannotRead = async (): Promise<boolean> => {
    throw new SyntaxError('Unexpected end of JSON input')
  }

  // Act
  const problems = [
    await findGeneratedWikiProblem(
      { isOwnedByProject: async () => false, readEntryPage: fails },
      '.codebook/wiki',
    ),
    await findGeneratedWikiProblem(
      { isOwnedByProject: async () => true, readEntryPage: fails },
      '.codebook/wiki',
    ),
    await findGeneratedWikiProblem(
      { isOwnedByProject: async () => true, readEntryPage: passes },
      '.codebook/wiki',
    ),
    await findGeneratedWikiProblem(
      { isOwnedByProject: cannotRead, readEntryPage: fails },
      '.codebook/wiki',
    ),
  ]

  // Assert
  assert.deepEqual(problems, [
    'The LLM Wiki published in .codebook/wiki does not identify this opened project. Set codebook.wikiOutputDirectory to a folder of this project, then press Generate LLM Wiki again.',
    'The LLM Wiki published in .codebook/wiki has no entry page Codebook can open (index.html). Ask the editor chat "/codebook Generate the LLM Wiki for this project" to publish it again.',
    undefined,
    'An LLM Wiki was published in .codebook/wiki, but Codebook cannot read its manifest. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project".',
  ])
})
