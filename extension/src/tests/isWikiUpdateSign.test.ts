import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWikiUpdateSign } from '../utils/isWikiUpdateSign'

const PLACES = {
  outputDirectory: '/repo/.codebook/wiki',
  skillDirectory: '/extensions/codebook/skills/codebook',
}

// Value: protects=the signs by which Codebook sees that the chat works on an update; fails_when=the manifest, a page of a prepared folder or the bundled skill is no longer recognised when the chat opens it, so a working chat is stopped at the bound; why_new=Cycle 0046 row 146; seam=none
test('the Wiki’s manifest, a file of a folder prepared beside the Wiki and the bundled skill are documents of an update', () => {
  // Act
  const signs = [
    '/repo/.codebook/wiki/codebook-wiki.json',
    '/repo/.codebook/wiki.stage-3f6c/pages/overview.html',
    '/extensions/codebook/skills/codebook/SKILL.md',
  ].map((path) => isWikiUpdateSign({ kind: 'document', path }, PLACES))

  // Assert
  assert.deepEqual(signs, [true, true, true])
})

// Value: protects=the bound of the first sign while the learner works; fails_when=a source file, a file beside the Wiki whose name only starts like its folder, or a file of another extension counts as the chat's work; why_new=Cycle 0046 row 146; seam=none
test('a source file, a file whose name only starts like the Wiki’s folder and a file of another skill are no documents of an update', () => {
  // Act
  const signs = [
    '/repo/src/a.ts',
    '/repo/.codebook/wiki-notes.md',
    '/extensions/codebook/skills/codebook-other/SKILL.md',
  ].map((path) => isWikiUpdateSign({ kind: 'document', path }, PLACES))

  // Assert
  assert.deepEqual(signs, [false, false, false])
})

// Value: protects=the same bound for commands; fails_when=any command the learner runs counts, or the publisher's command no longer does; why_new=Cycle 0046 row 146; seam=none
test('a command line that names the publisher’s script or the Wiki’s folder is a step of an update, and the learner’s own commands are not', () => {
  // Act
  const signs = [
    'node /extensions/codebook/skills/codebook/publish-wiki.mjs --prepare --project /repo --output /repo/.codebook/wiki',
    'ls -la /repo/.codebook/wiki',
    'pnpm test',
    'git status',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [true, true, false, false])
})

// Value: protects=the first sign of an update on Windows, where the editor reports a document's path with a lower-case drive letter; fails_when=the paths are compared letter by letter, so the manifest the chat opens is not recognised and a working chat is stopped at the bound; why_new=Cycle 0046 row 146 (found while the signs were tied to the Wiki's folder); seam=the platform, which the test names
test('on Windows the Wiki’s manifest is recognised although the editor spells the drive letter in lower case, and a file beside the folder is still none', () => {
  // Arrange
  const places = {
    outputDirectory: 'C:\\Repo\\.codebook\\wiki',
    skillDirectory:
      'C:\\Users\\dev\\.vscode\\extensions\\codebook\\skills\\codebook',
  }

  // Act
  const manifest = isWikiUpdateSign(
    { kind: 'document', path: 'c:\\Repo\\.codebook\\wiki\\codebook-wiki.json' },
    places,
    'win32',
  )
  const neighbour = isWikiUpdateSign(
    { kind: 'document', path: 'c:\\Repo\\.codebook\\wiki-notes.md' },
    places,
    'win32',
  )

  // Assert
  assert.equal(manifest, true)
  assert.equal(neighbour, false)
})
