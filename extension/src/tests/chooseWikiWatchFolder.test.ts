import assert from 'node:assert/strict'
import { win32 } from 'node:path'
import { test } from 'node:test'

import { chooseWikiWatchFolder } from '../utils/chooseWikiWatchFolder'

const HOME = '/Users/ada'

// Value: protects=the watcher standing on the project root in a fresh project; fails_when=a missing .codebook inside the project gives no watcher or one above the project; no_claim=the editor's watcher; seam=the pure function
test('a missing .codebook inside the project is watched from the project root', () => {
  // Arrange
  const choice = {
    projectRoot: '/work/repo',
    outputDirectory: '/work/repo/.codebook/wiki',
    nearestExistingFolder: '/work/repo',
    homeDirectory: HOME,
  }

  // Act
  const folder = chooseWikiWatchFolder(choice)

  // Assert
  assert.equal(folder, '/work/repo')
})

// Value: protects=N56-F3, a deleted .codebook being seen; fails_when=the watcher stands on .codebook (or a deeper folder) once it exists, where deleting that folder is an event of the watched folder itself and the editor reports none; why_new=the old choice returned the nearest existing folder; no_claim=the editor's watcher; seam=the pure function
test('an existing .codebook inside the project is still watched from the project root', () => {
  // Arrange
  const choice = {
    projectRoot: '/work/repo',
    outputDirectory: '/work/repo/.codebook/wiki',
    nearestExistingFolder: '/work/repo/.codebook',
    homeDirectory: HOME,
  }

  // Act
  const folder = chooseWikiWatchFolder(choice)

  // Assert
  assert.equal(folder, '/work/repo')
})

// Value: protects=the editor from a recursive watch of the home folder or the root; fails_when=an output outside the project whose parent does not exist is watched from the nearest existing ancestor, here the home folder; no_claim=what the view shows instead (host test); seam=the pure function
test('an output outside the project whose parent is missing gets no watcher, even when an ancestor exists', () => {
  // Arrange
  const choice = {
    projectRoot: '/work/repo',
    outputDirectory: '/Users/ada/x/y/wiki',
    nearestExistingFolder: HOME,
    homeDirectory: HOME,
  }

  // Act
  const folder = chooseWikiWatchFolder(choice)

  // Assert
  assert.equal(folder, undefined)
})

// Value: protects=the watch of an output outside the project; fails_when=an existing parent outside the project is refused, so such a Wiki is never refreshed by events; no_claim=the editor's watcher; seam=the pure function
test('an output outside the project is watched from its own parent when that exists', () => {
  // Arrange
  const choice = {
    projectRoot: '/work/repo',
    outputDirectory: '/data/notes/wiki',
    nearestExistingFolder: '/data/notes',
    homeDirectory: HOME,
  }

  // Act
  const folder = chooseWikiWatchFolder(choice)

  // Assert
  assert.equal(folder, '/data/notes')
})

// Value: protects=the editor from a recursive watch of the home folder or the root; fails_when=a project or an output parent that is the home folder or a file-system root is watched; no_claim=the Windows root forms beyond C:\; seam=the pure function with both path modules
test('the home folder and a file-system root are never watched', () => {
  // Arrange
  const projectAtHome = {
    projectRoot: HOME,
    outputDirectory: `${HOME}/.codebook/wiki`,
    nearestExistingFolder: HOME,
    homeDirectory: HOME,
  }
  const outputBelowRoot = {
    projectRoot: '/work/repo',
    outputDirectory: '/wiki',
    nearestExistingFolder: '/',
    homeDirectory: HOME,
  }
  const windowsRoot = {
    projectRoot: 'C:\\repo',
    outputDirectory: 'D:\\wiki',
    nearestExistingFolder: 'D:\\',
    homeDirectory: 'C:\\Users\\ada',
    pathApi: win32,
  }

  // Act
  const folders = [projectAtHome, outputBelowRoot, windowsRoot].map(
    chooseWikiWatchFolder,
  )

  // Assert
  assert.deepEqual(folders, [undefined, undefined, undefined])
})
