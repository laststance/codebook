import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { LIBRARY_LINK_DEPTH_LIMIT } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  detectLibraryPackage,
  type LibraryAppFolder,
} from '../utils/libraryBuildStop'

import { armedEntry } from './utils/entryRenderHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_NAME,
  LIBRARY_RETURN_LINE,
} from './utils/libraryBuildHarness'
import {
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerService } from './utils/pagesServerRunHarness'
import { removeTestFolder } from './utils/removeTestFolder'

const roots: string[] = []
after(async () => {
  await Promise.all(roots.map((root) => removeTestFolder(root)))
})

const CORE_STOP = 'packages/core/src/x.ts'

/** Writes `<folder>/package.json` with a name and an empty source file. */
async function writePackage(
  root: string,
  folder: string,
  name: string,
): Promise<void> {
  await mkdir(join(root, folder, 'src'), { recursive: true })
  await writeFile(join(root, folder, 'package.json'), JSON.stringify({ name }))
  await writeFile(join(root, folder, 'src/x.ts'), 'export const x = 1\n')
}

/** Links `<from>/node_modules/<name>` to the repository folder `to`. */
async function link(
  root: string,
  from: string,
  name: string,
  to: string,
): Promise<void> {
  const path = join(root, from, 'node_modules', name)
  await mkdir(join(path, '..'), { recursive: true })
  await symlink(join(root, to), path)
}

/** Stages a P02-shaped repository: an app, `react-lib`, `core`, and an unrelated `other`; no link yet. */
async function createRepository() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-chain-')))
  roots.push(root)
  await writePackage(root, 'examples/app', 'app')
  await writePackage(root, 'packages/react-lib', '@s/react-lib')
  await writePackage(root, 'packages/core', '@s/core')
  await writePackage(root, 'packages/other', '@s/other')
  const app: LibraryAppFolder = {
    packageRoot: join(root, 'examples/app') as LibraryAppFolder['packageRoot'],
    toPackageRelative: () => undefined,
    toPackageRelativeByRealPath: async () => undefined,
  }
  return { root, app }
}

// protects=a library the app reaches through another workspace library is detected, as Node resolves it; fails_when=only the app's or the root node_modules count, so the stop stays outside-package; no_claim=the build or the seal
test('detects a workspace library the app reaches through another workspace library', async () => {
  // Arrange
  const { root, app } = await createRepository()
  await link(root, 'examples/app', '@s/react-lib', 'packages/react-lib')
  await link(root, 'packages/react-lib', '@s/core', 'packages/core')
  // Act
  const library = await detectLibraryPackage(root, app, CORE_STOP)
  // Assert
  assert.deepEqual(library, {
    name: '@s/core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  })
})

// protects=AC 5: a sibling package no reached package links to is no library; fails_when=any package in the repository is sealed because a chain exists elsewhere; no_claim=nothing
test('does not detect a sibling package that no reached package links to', async () => {
  // Arrange
  const { root, app } = await createRepository()
  await link(root, 'examples/app', '@s/react-lib', 'packages/react-lib')
  await link(root, 'packages/react-lib', '@s/core', 'packages/core')
  // Act
  const library = await detectLibraryPackage(
    root,
    app,
    'packages/other/src/x.ts',
  )
  // Assert
  assert.equal(library, undefined)
})

// protects=installed packages are never followed; fails_when=a link into node_modules/.pnpm is walked and its dependencies count as workspace libraries; no_claim=nothing
test('does not follow a link that points into a node_modules store', async () => {
  // Arrange
  const { root, app } = await createRepository()
  await writePackage(
    root,
    'node_modules/.pnpm/store-lib@1/node_modules/store-lib',
    'store-lib',
  )
  await link(
    root,
    'examples/app',
    'store-lib',
    'node_modules/.pnpm/store-lib@1/node_modules/store-lib',
  )
  await link(
    root,
    'node_modules/.pnpm/store-lib@1/node_modules/store-lib',
    '@s/core',
    'packages/core',
  )
  // Act
  const library = await detectLibraryPackage(root, app, CORE_STOP)
  // Assert
  assert.equal(library, undefined)
})

// protects=a link cycle between workspace packages ends; fails_when=the walk loops forever (the per-test timeout fires) or throws; no_claim=which package is found
test('ends the walk when two workspace libraries link each other', async () => {
  // Arrange
  const { root, app } = await createRepository()
  await link(root, 'examples/app', '@s/react-lib', 'packages/react-lib')
  await link(root, 'packages/react-lib', '@s/core', 'packages/core')
  await link(root, 'packages/core', '@s/react-lib', 'packages/react-lib')
  // Act
  const library = await detectLibraryPackage(
    root,
    app,
    'packages/other/src/x.ts',
  )
  // Assert
  assert.equal(library, undefined)
})

// protects=the link depth bound; fails_when=a chain longer than the limit is still detected; no_claim=the exact limit value (derived from LIBRARY_LINK_DEPTH_LIMIT)
test('does not detect a library behind more links than the depth limit', async () => {
  // Arrange: app -> hop1 -> ... -> hopN -> core needs limit + 1 links.
  const { root, app } = await createRepository()
  const hops = LIBRARY_LINK_DEPTH_LIMIT
  let from = 'examples/app'
  for (let index = 0; index < hops; index += 1) {
    const folder = `packages/hop${index}`
    await writePackage(root, folder, `@s/hop${index}`)
    await link(root, from, `@s/hop${index}`, folder)
    from = folder
  }
  await link(root, from, '@s/core', 'packages/core')
  // Act
  const library = await detectLibraryPackage(root, app, CORE_STOP)
  // Assert
  assert.equal(library, undefined)
})

// protects=a chain right at the depth limit still works; fails_when=the bound is off by one and drops a legal chain; no_claim=nothing
test('detects a library behind exactly the depth limit of links', async () => {
  // Arrange
  const { root, app } = await createRepository()
  let from = 'examples/app'
  for (let index = 0; index < LIBRARY_LINK_DEPTH_LIMIT - 1; index += 1) {
    const folder = `packages/hop${index}`
    await writePackage(root, folder, `@s/hop${index}`)
    await link(root, from, `@s/hop${index}`, folder)
    from = folder
  }
  await link(root, from, '@s/core', 'packages/core')
  // Act
  const library = await detectLibraryPackage(root, app, CORE_STOP)
  // Assert
  assert.equal(library?.name, '@s/core')
})

// protects=a link leaving the repository is never followed; fails_when=a package outside the repository is walked to reach a library; no_claim=nothing
test('does not follow a link that leaves the repository', async () => {
  // Arrange
  const { root, app } = await createRepository()
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'library-out-')))
  roots.push(outside)
  await writePackage(outside, '.', 'outside')
  await symlink(outside, join(root, 'packages/outside'))
  await link(root, 'examples/app', 'outside', 'packages/outside')
  await link(root, 'packages/outside', '@s/core', 'packages/core')
  // Act
  const library = await detectLibraryPackage(root, app, CORE_STOP)
  // Assert
  assert.equal(library, undefined)
})

// protects=run level: a stop in a library reached through another workspace library pauses; fails_when=the run refuses the stop as outside-package so the server never starts; no_claim=a real Next compile or js-debug (scripted)
test('a server stop in a library the app reaches through another workspace library pauses', async (context) => {
  // Arrange: relink the fixture's direct app link into app -> react-lib -> lib.
  const staged = stageLibrary()
  const options = libraryRunOptions(staged)
  const direct = options.libraryStop!
  options.libraryStop = async (input) => {
    const files = await direct(input)
    const { directory } = input
    await rm(join(directory, LIBRARY_APP_FOLDER, 'node_modules', LIBRARY_NAME))
    await writePackage(directory, 'packages/react-lib', 'react-lib')
    await link(directory, LIBRARY_APP_FOLDER, 'react-lib', 'packages/react-lib')
    await link(directory, 'packages/react-lib', LIBRARY_NAME, 'packages/lib')
    return files
  }
  const run = await pagesServerService(context, options)
  const { harness, state } = run
  harness.server!.setFrameName('double')
  harness.server!.setScope({ doubled: 6 })
  run.holdMaintenance()
  await armedEntry(harness)
  // Act
  harness.server!.hit({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  await waitUntil(() => state().state === 'paused-server', 'the library pause')
  // Assert
  assert.equal(state().state, 'paused-server')
})
