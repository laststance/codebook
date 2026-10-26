import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeUnrevealableWikiFolder } from '../utils/describeUnrevealableWikiFolder'

// Value: protects=Reveal Wiki Folder names the useful reason first; fails_when=a missing folder in a remote window is told as "on the remote host" or an empty remote name blocks a local reveal; why_new=llmWikiView.test.ts covers missing and remote separately, never both and never the empty name; seam=none; no_claim=the editor's reveal command
test('Reveal Wiki Folder names a missing folder before the remote host and lets a local window reveal', () => {
  // Arrange
  const missingInRemote = {
    outputLabel: '.codebook/wiki',
    exists: false,
    remoteName: 'wsl',
  }
  const existingInLocal = {
    outputLabel: '.codebook/wiki',
    exists: true,
    remoteName: '',
  }

  // Act
  const results = [
    describeUnrevealableWikiFolder(missingInRemote),
    describeUnrevealableWikiFolder(existingInLocal),
  ]

  // Assert
  assert.deepEqual(results, [
    'The LLM Wiki folder .codebook/wiki does not exist (yet).',
    undefined,
  ])
})
