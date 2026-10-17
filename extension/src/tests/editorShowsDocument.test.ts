import assert from 'node:assert/strict'
import { test } from 'node:test'

import { editorShowsDocument } from '../utils/editorShowsDocument'

// Value: protects=the sentences that say the captured source has the keyboard (an agent's Study selection, its failure) and the note that Codebook's placement gave it the keyboard (row 642), which must not be made while there is no captured source at all; fails_when=a reader without a captured source, with no active text editor (the keyboard in the chat, the terminal or a view), answers that the captured source is the active text editor because two missing values compare equal; why_new=Cycle 0046 row 651; seam=none
test('no captured source is the active text editor while no text editor is active', () => {
  // Arrange
  const activeTextEditor = undefined,
    capturedSourceUri = undefined

  // Act
  const capturedSourceIsActive = editorShowsDocument(
    activeTextEditor,
    capturedSourceUri,
  )

  // Assert
  assert.equal(capturedSourceIsActive, false)
})

// Value: protects=the same sentences and note while the learner's own file is the active text editor and the reader has no captured source; fails_when=a missing captured source is taken for any document; why_new=Cycle 0046 row 651; seam=none
test('no captured source is the active text editor while the learner’s own file is active', () => {
  // Arrange
  const activeTextEditor = {
    document: { uri: 'file:///workspace/src/actions.ts' },
  }

  // Act
  const capturedSourceIsActive = editorShowsDocument(
    activeTextEditor,
    undefined,
  )

  // Assert
  assert.equal(capturedSourceIsActive, false)
})

// Value: protects=the sentence an agent's Study selection tells once the captured source holds the keyboard (row 613); fails_when=the captured source that is the active text editor is not recognized, so the learner is not told where the keyboard is; why_new=Cycle 0046 row 651; seam=none
test('the captured source is the active text editor while the editor shows its document', () => {
  // Arrange
  const capturedSourceUri = 'codebook-source:/run-1/Captured-overview.mts'
  const activeTextEditor = {
    document: { uri: 'codebook-source:/run-1/Captured-overview.mts' },
  }

  // Act
  const capturedSourceIsActive = editorShowsDocument(
    activeTextEditor,
    capturedSourceUri,
  )

  // Assert
  assert.equal(capturedSourceIsActive, true)
})

// Value: protects=the learner's own file from being named as the captured source in those sentences; fails_when=another document of the active text editor is taken for the captured source; why_new=Cycle 0046 row 651; seam=none
test('another document of the active text editor is not the captured source', () => {
  // Arrange
  const capturedSourceUri = 'codebook-source:/run-1/Captured-overview.mts'
  const activeTextEditor = {
    document: { uri: 'file:///workspace/src/actions.ts' },
  }

  // Act
  const capturedSourceIsActive = editorShowsDocument(
    activeTextEditor,
    capturedSourceUri,
  )

  // Assert
  assert.equal(capturedSourceIsActive, false)
})
