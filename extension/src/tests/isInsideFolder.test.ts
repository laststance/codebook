import assert from 'node:assert/strict'
import * as path from 'node:path'
import { test } from 'node:test'

import { isInsideFolder } from '../utils/isInsideFolder'

// Value: protects=a learner on Windows whose Wiki folder holds a file the manifest lists that is a link to another drive: Windows' relative path to it is the path itself, which begins with neither `..` nor nothing, so the reader took it for a file of the Wiki folder and served it; fails_when=a path on another drive counts as inside the Wiki folder; why_new=Cycle 0047 row 272 (P3SEC-1); seam=none (path.win32, Windows' own path functions, on any system); no_claim=a real link on Windows (the reader resolves it with realpath before this check)
test('a file of a Windows Wiki folder whose real path is on another drive is not inside the Wiki folder', () => {
  // Arrange
  const wikiFolder = 'C:\\repo\\.codebook\\wiki'

  // Act
  const inside = isInsideFolder(
    wikiFolder,
    'D:\\secret\\diagram.png',
    path.win32,
  )

  // Assert
  assert.equal(inside, false)
})

// Value: protects=a learner on Windows whose Wiki folder holds a file the manifest lists that is a link to a network share: Windows' relative path to it is the share's path itself, so the reader took it for a file of the Wiki folder and served it; fails_when=a path on a share counts as inside the Wiki folder; why_new=Cycle 0047 row 272 (P3SEC-1); seam=none (path.win32 on any system); no_claim=a real share
test('a file of a Windows Wiki folder whose real path is on a network share is not inside the Wiki folder', () => {
  // Arrange
  const wikiFolder = 'C:\\repo\\.codebook\\wiki'

  // Act
  const inside = isInsideFolder(
    wikiFolder,
    '\\\\server\\share\\diagram.png',
    path.win32,
  )

  // Assert
  assert.equal(inside, false)
})

// Value: protects=every file of a learner's Wiki on Windows, which the reader must still serve; fails_when=a file below the Wiki folder on Windows, in a subfolder or with another case of its drive letter, is taken for one outside it; why_new=Cycle 0047 row 272 (P3SEC-1): the check of another drive must keep the files of the Wiki folder itself; seam=none (path.win32 on any system); no_claim=none beyond protects
test('a file below a Windows Wiki folder, also one whose drive letter is written in another case, is inside the Wiki folder', () => {
  // Arrange
  const wikiFolder = 'C:\\repo\\.codebook\\wiki'

  // Act
  const insideness = [
    isInsideFolder(
      wikiFolder,
      'C:\\repo\\.codebook\\wiki\\pages\\guide.html',
      path.win32,
    ),
    isInsideFolder(
      wikiFolder,
      'c:\\repo\\.codebook\\wiki\\wiki.css',
      path.win32,
    ),
  ]

  // Assert
  assert.deepEqual(insideness, [true, true])
})

// Value: protects=the reader's refusal on macOS and Linux of a file the manifest lists that is a link out of the Wiki folder, and its service of every file below it; fails_when=the folder itself, the folder above it or a folder beside it whose name starts like it counts as inside, or a file below it whose name starts with two dots counts as outside; why_new=Cycle 0047 row 272 (P3SEC-1): the check moved out of the reader into its own function; seam=none (path.posix on any system); no_claim=a real link (the reader's own test of a symlink that leaves the folder)
test('on macOS and Linux a file below the Wiki folder is inside it, and the folder itself, the folder above it and a folder beside it are not', () => {
  // Arrange
  const wikiFolder = '/repo/.codebook/wiki'

  // Act
  const insideness = {
    fileBelow: isInsideFolder(
      wikiFolder,
      '/repo/.codebook/wiki/pages/guide.html',
      path.posix,
    ),
    fileWithTwoDots: isInsideFolder(
      wikiFolder,
      '/repo/.codebook/wiki/..notes.css',
      path.posix,
    ),
    folderItself: isInsideFolder(
      wikiFolder,
      '/repo/.codebook/wiki',
      path.posix,
    ),
    folderAbove: isInsideFolder(wikiFolder, '/repo/.codebook', path.posix),
    folderBeside: isInsideFolder(
      wikiFolder,
      '/repo/.codebook/wiki-old/wiki.css',
      path.posix,
    ),
  }

  // Assert
  assert.deepEqual(insideness, {
    fileBelow: true,
    fileWithTwoDots: true,
    folderItself: false,
    folderAbove: false,
    folderBeside: false,
  })
})
