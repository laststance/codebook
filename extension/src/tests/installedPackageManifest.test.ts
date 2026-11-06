import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { isNpmPackageName } from '../utils/isNpmPackageName'
import { readInstalledPackageManifest } from '../utils/readInstalledPackageManifest'

// protects=real npm names (scoped, 214-character, dotted) are accepted so a legitimate library is not refused; fails_when=the length bound drops to 213 or the scope form stops matching; no_claim=names npm would reject for reserved words
// Value: protects=isNpmPackageName length and scope boundaries; fails_when=the 214 bound or scope form changes; why_new=libraryPackageNameShape.test.ts covers refused shapes, not the accepted boundary; seam=none; no_claim=reserved names
test('accepts scoped, dotted and 214-character package names and rejects 215', () => {
  // Arrange
  const longest = 'a'.repeat(214)
  // Act
  const results = [
    isNpmPackageName('@reduxjs/toolkit'),
    isNpmPackageName('lodash.merge'),
    isNpmPackageName(longest),
    isNpmPackageName(`${longest}a`),
    isNpmPackageName('@scope/'),
  ]
  // Assert
  assert.deepEqual(results, [true, true, true, false, false])
})

// protects=the install check finds a hoisted dependency in an ancestor node_modules and reads a manifest that hides ./package.json from exports; fails_when=the walk stops at the first folder or resolves through exports; no_claim=symlinked installs
// Value: protects=readInstalledPackageManifest walks up to a hoisted install (D19); fails_when=the walk stops early or goes through exports; why_new=libraryPackage.test.ts reaches it only through refusals; seam=none; no_claim=symlinked installs
test('finds a dependency hoisted above the library folder and reports its version', async (context) => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'installed-manifest-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  const installed = join(root, 'node_modules', '@scope', 'dep')
  await mkdir(installed, { recursive: true })
  await writeFile(
    join(installed, 'package.json'),
    JSON.stringify({
      name: '@scope/dep',
      version: '2.3.4',
      exports: { '.': './i.js' },
    }),
  )
  const deep = join(root, 'packages', 'toolkit')
  await mkdir(deep, { recursive: true })
  // Act
  const found = await readInstalledPackageManifest(deep, '@scope/dep')
  const missing = await readInstalledPackageManifest(deep, 'absent-package-xyz')
  // Assert
  assert.deepEqual(found, {
    manifestPath: join(installed, 'package.json'),
    version: '2.3.4',
  })
  assert.equal(missing, undefined)
})
