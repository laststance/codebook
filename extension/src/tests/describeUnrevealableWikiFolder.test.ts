import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeUnrevealableWikiFolder } from '../utils/describeUnrevealableWikiFolder'

// Value: protects=Reveal Wiki Folder names the useful reason first; fails_when=a missing folder in a remote window is told as "on the remote host" or an empty remote name blocks a local reveal; why_new=llmWikiView.test.ts covers missing and remote separately, never both and never the empty name; seam=none; no_claim=the editor's reveal command
test('Reveal Wiki Folder names a missing folder before the remote host and lets a local window reveal', () => {
  // Arrange
  const missingInRemote = {
    outputLabel: '.codebook/wiki',
    folderKind: { kind: 'missing' } as const,
    remoteName: 'wsl',
  }
  const existingInLocal = {
    outputLabel: '.codebook/wiki',
    folderKind: { kind: 'folder' } as const,
    remoteName: '',
  }

  // Act
  const results = [
    describeUnrevealableWikiFolder(missingInRemote),
    describeUnrevealableWikiFolder(existingInLocal),
  ]

  // Assert
  assert.deepEqual(results, [
    'The LLM Wiki folder .codebook/wiki does not exist (yet). Generate LLM Wiki creates it.',
    undefined,
  ])
})

// Value: protects=RT2-B and D2 (each reason gives its next step; WSL is local); fails_when=a file in the folder's place is told as missing, a remote reason lacks the next step, or WSL is refused as remote; why_new=the test above covers missing and local only; seam=none; no_claim=the editor's reveal command
test('Reveal Wiki Folder words a file, a remote host with its next step, and lets WSL reveal', () => {
  // Arrange
  const fileInPlace = {
    outputLabel: 'docs/wiki',
    folderKind: { kind: 'file' } as const,
  }
  const existingInSsh = {
    outputLabel: 'docs/wiki',
    folderKind: { kind: 'folder' } as const,
    remoteName: 'ssh-remote',
  }
  const existingInWsl = {
    outputLabel: 'docs/wiki',
    folderKind: { kind: 'folder' } as const,
    remoteName: 'wsl',
  }

  // Act
  const results = [
    describeUnrevealableWikiFolder(fileInPlace),
    describeUnrevealableWikiFolder(existingInSsh),
    describeUnrevealableWikiFolder(existingInWsl),
  ]

  // Assert
  assert.deepEqual(results, [
    'The LLM Wiki folder docs/wiki is a file, not a folder. Remove or rename that file, or change the location.',
    'Reveal Wiki Folder opens folders on this computer only; the Wiki folder is on ssh-remote. Open it from a terminal in this window, which runs in that remote environment, not on this computer.',
    undefined,
  ])
})

// Value: protects=RT3-c (an unreadable path is not told as missing); fails_when=a path the look could not read is worded "does not exist (yet)", or the remote reason hides it; why_new=the tests above cover folder, file and missing only; seam=none; no_claim=the system call that failed
test('Reveal Wiki Folder words an unreadable path with its error code and a next step, before the remote host', () => {
  // Arrange
  const unreadableInRemote = {
    outputLabel: '.codebook/wiki',
    folderKind: { kind: 'unreadable', code: 'EACCES' } as const,
    remoteName: 'ssh-remote',
  }

  // Act
  const result = describeUnrevealableWikiFolder(unreadableInRemote)

  // Assert
  assert.equal(
    result,
    'The LLM Wiki folder .codebook/wiki cannot be read (EACCES). Check the path and its permissions, or change the location.',
  )
})

// Value: protects=F2 (b) and F3 (a link to nothing and a look that timed out have their own words); fails_when=a dangling link is worded as missing, or a timeout is worded as a permission problem only; no_claim=the system call that failed; seam=none
test('Reveal Wiki Folder words a link whose target is missing, and a look that timed out', () => {
  // Arrange
  const danglingLink = {
    outputLabel: '.codebook/wiki',
    folderKind: { kind: 'dangling-link' } as const,
  }
  const timedOut = {
    outputLabel: '.codebook/wiki',
    folderKind: { kind: 'unreadable', code: 'ETIMEDOUT' } as const,
  }

  // Act
  const results = [
    describeUnrevealableWikiFolder(danglingLink),
    describeUnrevealableWikiFolder(timedOut),
  ]

  // Assert
  assert.deepEqual(results, [
    'The LLM Wiki folder .codebook/wiki is a link whose target is missing. Remove or fix the link, or change the location.',
    'The LLM Wiki folder .codebook/wiki cannot be read (ETIMEDOUT). Check the path and its permissions, or change the location.',
  ])
})
