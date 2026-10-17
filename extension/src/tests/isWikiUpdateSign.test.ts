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
    'node /extensions/codebook/skills/codebook/publish-wiki.mjs --prepare --project . --output .codebook/wiki',
    'ls -la /repo/.codebook/wiki',
    'pnpm test',
    'git status',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [true, true, false, false])
})

// Value: protects=the learner who runs a command of their own in the half minute the chat has not answered yet; fails_when=a command that names a folder beside the Wiki whose name only starts like it, or that mentions the publisher's script in its text or as a file it reads, counts as the chat's work, so Codebook skips the withdrawal of the unanswered request, watches for up to 15 minutes, reserves the Wiki, and refuses later updates although none runs; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); seam=none
test('a command that names a folder beside the Wiki’s folder, or mentions the publisher’s script only in quoted text, in another argument or as a name without its folder, is no step of an update', () => {
  // Act
  const signs = [
    'ls /repo/.codebook/wiki-backup',
    'echo "run publish-wiki.mjs --output /repo/.codebook/wiki later"',
    "git commit -m 'publish-wiki.mjs: fix /repo/.codebook/wiki'",
    'grep -n publish-wiki.mjs notes.md',
    'node scripts/check.mjs /extensions/codebook/skills/codebook/publish-wiki.mjs.bak',
    'node publish-wiki.mjs --output /repo/.codebook/wiki-backup',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [false, false, false, false, false, false])
})

// Value: protects=the first sign of an update in the chat's terminal, however the chat quotes its paths; fails_when=reading the command by its argument boundaries loses the publisher's command when its paths are quoted, follow a change of folder, or name the Wiki's folder with a trailing slash, so a working chat is stopped at the bound; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); seam=none
test('the publisher run with the Wiki’s folder as its exact --output value is a step of an update, quoted or unquoted, after a change of folder and with a trailing slash', () => {
  // Act
  const signs = [
    'node /extensions/codebook/skills/codebook/publish-wiki.mjs --prepare --project /repo --output /repo/.codebook/wiki',
    'node "/extensions/codebook/skills/codebook/publish-wiki.mjs" --project "/repo" --output "/repo/.codebook/wiki"',
    "cd /repo && node '/extensions/codebook/skills/codebook/publish-wiki.mjs' --recover --project . --output .codebook/wiki",
    'node --no-warnings ./publish.mjs --output /repo/.codebook/wiki/',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [true, true, true, true])
})

// Value: protects=the same reading of a command on Windows, where a path's backslash is no escape and the drive letter may be spelled in either case; fails_when=the backslashes of a path are read as escapes, so the publisher's command is not recognised, or a folder beside the Wiki counts; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); seam=the platform, which the test names
test('on Windows the publisher’s command with quoted backslash paths is a step of an update, and a folder beside the Wiki’s folder is not', () => {
  // Arrange
  const places = {
    outputDirectory: 'C:\\Repo\\.codebook\\wiki',
    skillDirectory:
      'C:\\Users\\dev\\.vscode\\extensions\\codebook\\skills\\codebook',
  }

  // Act
  const signs = [
    '& "C:\\Program Files\\nodejs\\node.exe" "c:\\Users\\dev\\.vscode\\extensions\\codebook\\skills\\codebook\\publish-wiki.mjs" --prepare --project C:\\Repo --output C:\\Repo\\.codebook\\wiki',
    'dir C:\\Repo\\.codebook\\wiki-backup',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, places, 'win32'),
  )

  // Assert
  assert.deepEqual(signs, [true, false])
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
