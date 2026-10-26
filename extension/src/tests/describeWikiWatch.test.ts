import assert from 'node:assert/strict'
import { posix, win32 } from 'node:path'
import { test } from 'node:test'

import { describeWikiWatch } from '../utils/describeWikiWatch'

// Value: protects=the watcher seeing the Wiki folder itself and a folder not made yet; fails_when=the glob lists only the four files, so the delete of the output folder alone (or the creation of .codebook) is never reported; no_claim=the editor's glob engine; seam=the pure function with the POSIX path module
test('the plan lists the output folder, the folders between it and the watched folder, and the four files', () => {
  // Arrange
  const watchedFolder = '/repo'
  const outputDirectory = '/repo/.codebook/wiki'

  // Act
  const plan = describeWikiWatch(watchedFolder, outputDirectory, posix)

  // Assert
  assert.deepEqual(plan, {
    glob: '{.codebook,.codebook/wiki,.codebook/wiki/codebook-wiki.json,.codebook/wiki.update-run.json,.codebook/wiki.publish-lock.json,.codebook/wiki.publish-journal.json}',
    paths: [
      '/repo/.codebook',
      '/repo/.codebook/wiki',
      '/repo/.codebook/wiki/codebook-wiki.json',
      '/repo/.codebook/wiki.update-run.json',
      '/repo/.codebook/wiki.publish-lock.json',
      '/repo/.codebook/wiki.publish-journal.json',
    ],
  })
})

// Value: protects=a folder named with glob characters; fails_when=`a]b` or `wiki[1]` is embedded raw so the editor reads a character class; no_claim=the editor's glob engine; seam=the pure function
test('glob characters of the folder names are escaped in every entry of the glob', () => {
  // Arrange
  const watchedFolder = '/repo/docs'
  const outputDirectory = '/repo/docs/a]b'

  // Act
  const plan = describeWikiWatch(watchedFolder, outputDirectory, posix)

  // Assert
  assert.equal(
    plan?.glob,
    '{a[]]b,a[]]b/codebook-wiki.json,a[]]b.update-run.json,a[]]b.publish-lock.json,a[]]b.publish-journal.json}',
  )
})

// Value: protects=a Wiki output on another Windows drive than the watched folder; fails_when=the relative path is absolute and becomes a glob that matches nothing instead of the no-watcher fallback; no_claim=a real Windows host; seam=the pure function with path.win32
test('an output on another Windows drive has no plan, and a folder above the watched one has none either', () => {
  // Arrange
  const watchedFolder = 'C:\\repo'

  // Act
  const plans = [
    describeWikiWatch(watchedFolder, 'D:\\wiki', win32),
    describeWikiWatch(watchedFolder, 'C:\\other\\wiki', win32),
    describeWikiWatch('/repo/sub', '/repo', posix),
  ]

  // Assert
  assert.deepEqual(plans, [undefined, undefined, undefined])
})

// Value: protects=the exact-path filter on Windows; fails_when=the absolute paths use forward slashes while the glob uses backslashes, or the reverse; no_claim=drive letter case (comparableFilePath tests); seam=the pure function with path.win32
test('on Windows the glob uses forward slashes and the paths keep the drive and backslashes', () => {
  // Arrange
  const watchedFolder = 'C:\\repo\\.codebook'
  const outputDirectory = 'C:\\repo\\.codebook\\wiki'

  // Act
  const plan = describeWikiWatch(watchedFolder, outputDirectory, win32)

  // Assert
  assert.deepEqual(plan, {
    glob: '{wiki,wiki/codebook-wiki.json,wiki.update-run.json,wiki.publish-lock.json,wiki.publish-journal.json}',
    paths: [
      'C:\\repo\\.codebook\\wiki',
      'C:\\repo\\.codebook\\wiki\\codebook-wiki.json',
      'C:\\repo\\.codebook\\wiki.update-run.json',
      'C:\\repo\\.codebook\\wiki.publish-lock.json',
      'C:\\repo\\.codebook\\wiki.publish-journal.json',
    ],
  })
})
