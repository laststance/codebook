import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { assertLibraryRouteSupported } from '../utils/assertLibraryRouteSupported'
import { describeLibraryBuild } from '../utils/describeLibraryBuild'
import { readLibraryPackageName } from '../utils/readLibraryPackageName'

import { removeTestFolder } from './utils/removeTestFolder'

/** Makes a repository with `packages/toolkit/package.json` holding the given name; removed when the test ends. */
async function repositoryWithLibraryName(
  context: { after: (cleanup: () => Promise<void>) => void },
  name: string,
): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-name-')))
  context.after(() => removeTestFolder(root))
  await mkdir(join(root, 'packages', 'toolkit'), { recursive: true })
  await writeFile(
    join(root, 'packages', 'toolkit', 'package.json'),
    JSON.stringify({ name, scripts: { build: 'true' } }),
  )
  await mkdir(join(root, 'examples', 'node'), { recursive: true })
  return root
}

const INVALID_NAMES = [
  '../../evil',
  '@scope/../x',
  'bad\nname',
  'bad\u0007name',
  'has space',
  '.hidden',
  'a'.repeat(215),
]

// protects=a library whose package.json name is not an npm package name is refused as not-a-package before any path is built from it; fails_when=a traversal, newline, control-character or over-long name passes the checks; no_claim=names npm itself would reject for other reasons
test('refuses a library whose package name is not a plain npm name', async (context) => {
  for (const name of INVALID_NAMES) {
    // Arrange
    const root = await repositoryWithLibraryName(context, name)
    // Act
    const refusal = await assertLibraryRouteSupported({
      repositoryRoot: root,
      examplePackageRoot: join(root, 'examples', 'node'),
      declaredPackageRoot: 'packages/toolkit',
      node: { executable: '/node/bin/node', version: '24.22.1' },
      pathText: '/usr/bin',
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    // Assert
    assert.ok(refusal instanceof Error, JSON.stringify(name))
    assert.equal(
      Reflect.get(Reflect.get(refusal, 'details') ?? {}, 'reason'),
      'not-a-package',
      JSON.stringify(name),
    )
  }
})

// protects=the history header and the confirmation carry the real package name read from the library's package.json; fails_when=the real name is replaced by the folder or dropped; no_claim=the header's rendering
test('reads the real package name of a scoped library for the header and the dialog', async (context) => {
  // Arrange
  const root = await repositoryWithLibraryName(context, '@reduxjs/toolkit')
  // Act
  const name = await readLibraryPackageName(root, 'packages/toolkit')
  const description = await describeLibraryBuild(
    root,
    'packages/toolkit',
    '/node/bin/node',
  )
  // Assert
  assert.equal(name, '@reduxjs/toolkit')
  assert.equal(description?.package, '@reduxjs/toolkit')
})

// protects=an invalid name is never quoted: the read gives nothing so the header and the dialog fall back to the declared folder; fails_when=a newline, control character or over-long name reaches the dialog; no_claim=the fallback wording
test('reads no name for an invalid package name so the declared folder is shown', async (context) => {
  for (const name of INVALID_NAMES) {
    // Arrange
    const root = await repositoryWithLibraryName(context, name)
    // Act
    const read = await readLibraryPackageName(root, 'packages/toolkit')
    const description = await describeLibraryBuild(
      root,
      'packages/toolkit',
      '/node/bin/node',
    )
    // Assert
    assert.equal(read, undefined, JSON.stringify(name))
    assert.equal(description, undefined, JSON.stringify(name))
  }
})

// protects=a library.packageRoot whose real path leaves the repository is never read for the dialog or the header; fails_when=a package.json outside the repository, reached through a link, supplies the quoted name; no_claim=Windows junctions
test('does not read a package.json that a link places outside the repository', async (context) => {
  // Arrange
  const root = await repositoryWithLibraryName(context, 'inside')
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'library-out-')))
  context.after(() => removeTestFolder(outside))
  await writeFile(join(outside, 'package.json'), '{"name":"leaked-name"}')
  await symlink(outside, join(root, 'packages', 'linked'), 'dir')
  // Act
  const name = await readLibraryPackageName(root, 'packages/linked')
  // Assert
  assert.equal(name, undefined)
})
