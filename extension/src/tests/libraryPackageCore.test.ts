import assert from 'node:assert/strict'
import { chmodSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import {
  prepareLibraryCore,
  writeLibraryAnchor,
  type LibraryPackageDependencies,
} from '../libraryPackage'

import {
  createLibraryClock,
  createLibraryFixture,
  createRouteSpawner,
  EVERY_PATH_IS_A_PROGRAM,
  FIXTURE_NODE,
} from './utils/libraryRouteFixture'
import { writeTestTarball } from './utils/writeTestTarball'

/** Prepares the shared core of a fixture whose pack writes a tarball with the given packed manifest. */
function setUp(packedManifest: Record<string, unknown>) {
  const fixture = createLibraryFixture()
  const route = createRouteSpawner(fixture.libraryRoot, {
    onBuild: (control) => control.exit({ code: 0, signal: null }),
    onPack: (control) => {
      writeTestTarball(
        { 'package.json': JSON.stringify(packedManifest) },
        join(fixture.privateFolder, 'lib-2.0.0.tgz'),
      )
      control.exit({ code: 0, signal: null })
    },
  })
  const dependencies: LibraryPackageDependencies = {
    node: FIXTURE_NODE,
    signal: new AbortController().signal,
    clock: createLibraryClock(),
    spawner: route.spawner,
    isProgramFile: EVERY_PATH_IS_A_PROGRAM,
    hostEnvironment: { PATH: '/usr/bin' },
  }
  return {
    fixture,
    prepare: () =>
      prepareLibraryCore(
        fixture.configuration.library.packageRoot,
        fixture.roots,
        dependencies,
      ),
  }
}

// protects=the shared core returns the packed root, the packed peers and the packed imports map without any Node hook file; fails_when=the core writes the hook, drops the peers or the imports, or returns another folder than <private>/node_modules/<name>; no_claim=that real pnpm packs (the spawner is a fake) or that a Vite page resolves through these values
test('the shared core returns the packed root, peers and imports and writes no Node hook', async () => {
  // Arrange
  const { fixture, prepare } = setUp({
    name: 'lib',
    version: '2.0.0',
    peerDependencies: { react: '^18.0.0', 'react-redux': '^9.0.0' },
    imports: { '#internal': './dist/internal.js' },
  })
  // Act
  const prepared = await prepare()
  // Assert
  assert.equal(prepared.packedRoot.endsWith(join('node_modules', 'lib')), true)
  assert.deepEqual(prepared.peers, ['react', 'react-redux'])
  assert.deepEqual(prepared.imports, { '#internal': './dist/internal.js' })
  assert.equal(prepared.facts.version, '2.0.0')
  assert.equal(prepared.libraryRoot.endsWith(join('packages', 'lib')), true)
  assert.throws(() =>
    readFileSync(join(fixture.privateFolder, 'library-hook.mjs')),
  )
  await prepared.dispose()
})

// protects=a packed manifest with no imports map reads as undefined and an imports value that is not an object is not taken for one; fails_when=an array or a string is returned as the imports map; no_claim=none beyond protects
test('the shared core reads a packed imports value that is not a map as none', async () => {
  // Arrange
  const { prepare } = setUp({
    name: 'lib',
    version: '2.0.0',
    imports: ['#internal'],
  })
  // Act
  const prepared = await prepare()
  // Assert
  assert.equal(prepared.imports, undefined)
  assert.deepEqual(prepared.peers, [])
  await prepared.dispose()
})

// protects=the Vite route's anchor file is written inside the private folder and removed with it; fails_when=the anchor is missing, lies outside the private folder or survives dispose; no_claim=how Vite resolves from it
test('writeLibraryAnchor writes codebook-anchor.js in the private folder and dispose removes it', async () => {
  // Arrange
  const { fixture, prepare } = setUp({ name: 'lib', version: '2.0.0' })
  const prepared = await prepare()
  // Act
  const anchor = await writeLibraryAnchor(prepared)
  const text = readFileSync(anchor, 'utf8')
  const cleanup = await prepared.dispose()
  // Assert
  assert.equal(anchor, join(prepared.privateFolder, 'codebook-anchor.js'))
  assert.match(text, /export \{\}/)
  assert.equal(cleanup.cleanup, 'removed')
  assert.throws(() =>
    readFileSync(join(fixture.privateFolder, 'codebook-anchor.js')),
  )
})

// protects=an anchor that cannot be written ends the preparation as LIBRARY_BUILD_FAILED pack-error with step link and removes the private folder; fails_when=the failure is another reason or step, or the private folder stays; no_claim=none beyond protects (a read-only folder stands in for a full disk)
test('writeLibraryAnchor fails as a pack-error with step link when the file cannot be written', async (context) => {
  // Arrange
  const { prepare } = setUp({ name: 'lib', version: '2.0.0' })
  const prepared = await prepare()
  chmodSync(prepared.privateFolder, 0o500)
  context.after(() => {
    chmodSync(prepared.privateFolder, 0o700)
    rmSync(prepared.privateFolder, { recursive: true, force: true })
  })
  // Act
  const error = await writeLibraryAnchor(prepared).catch(
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'LIBRARY_BUILD_FAILED')
  assert.equal(error.details?.reason, 'pack-error')
  assert.equal(error.details?.step, 'link')
})
