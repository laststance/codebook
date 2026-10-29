import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { canonicalFsPath } from '../utils/canonicalFsPath'

// protects=LR-W1 (Cycle 0062 ship last round): a stop file reached through a symlinked folder meets the editor's path of the same file; fails_when=the canonical forms differ, so the paused file never moves; no_claim=Windows symlinks
test(
  'a symlinked path and the real path of a file have one canonical form',
  // A folder symlink needs a privilege Windows grants only to administrators or in developer mode.
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), 'canonical-'))
    context.after(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, 'settings.js'), '')
    await symlink(root, join(root, 'link'))
    // Act
    const viaLink = canonicalFsPath(join(root, 'link', 'settings.js'), 'linux')
    const direct = canonicalFsPath(join(root, 'settings.js'), 'linux')
    // Assert
    assert.equal(viaLink, direct)
  },
)

// protects=LR-W1: on a case-insensitive platform a differently-cased path matches, on Linux it does not; fails_when=darwin or win32 compare case-sensitively (a lowercased Windows drive letter never matches) or Linux folds case; no_claim=the volume's real case rule
test('paths differing in case match on darwin and win32 only', () => {
  // Arrange
  const given = '/Repo/Settings.js',
    reported = '/repo/settings.js'
  // Act
  const darwinMatches =
    canonicalFsPath(given, 'darwin') === canonicalFsPath(reported, 'darwin')
  const win32Matches =
    canonicalFsPath(given, 'win32') === canonicalFsPath(reported, 'win32')
  const linuxMatches =
    canonicalFsPath(given, 'linux') === canonicalFsPath(reported, 'linux')
  // Assert
  assert.deepEqual(
    [darwinMatches, win32Matches, linuxMatches],
    [true, true, false],
  )
})
