import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { prepareLibraryPackage } from '../libraryPackage'

import {
  createRouteSpawner,
  EVERY_PATH_IS_A_PROGRAM,
  FIXTURE_NODE,
  createLibraryFixture,
  listFolderState,
} from './utils/libraryRouteFixture'

/** Prepares the fixture library (fake build and pack, real tarball) and returns it with a runner that starts the real `node` with the hook. */
async function prepared() {
  const fixture = createLibraryFixture()
  const route = createRouteSpawner(fixture.libraryRoot)
  const library = await prepareLibraryPackage(
    fixture.configuration,
    fixture.roots,
    {
      node: FIXTURE_NODE,
      signal: new AbortController().signal,
      spawner: route.spawner,
      isProgramFile: EVERY_PATH_IS_A_PROGRAM,
      hostEnvironment: { PATH: '/usr/bin' },
    },
  )
  const run = (script: string): string =>
    execFileSync(process.execPath, [...library.nodeArguments, script], {
      cwd: fixture.examplePackageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  return { fixture, library, run }
}

// protects=an ES module Example that imports the library, a subpath, another package, the Example's peer, a dependency that imports the library and an unexported subpath resolves each as the installed tarball would; fails_when=any import reaches the published copy, the wrong dependency copy or a second peer; no_claim=bundler resolution, other conditions than import and require
test('resolves import of the library, a subpath, a peer, a dependency and a hidden subpath as the packed install would', async () => {
  // Arrange
  const { library, run } = await prepared()
  // Act
  const result: unknown = JSON.parse(run('run-import.mjs'))
  // Assert
  assert.deepEqual(result, {
    origin: 'packed',
    subOrigin: 'packed-sub',
    dep: 'library-dependency',
    other: 'other',
    samePeer: true,
    midOrigin: 'packed',
    hidden: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  })
  await library.dispose()
})

// protects=a CommonJS Example resolves require of the library, a subpath and the peer like the import side and an unexported subpath fails; fails_when=require reaches the published copy because the hook ignored the require condition; no_claim=require(esm) of the packed copy
test('resolves require of the library, a subpath, a peer and a hidden subpath as the packed install would', async () => {
  // Arrange
  const { library, run } = await prepared()
  // Act
  const result: unknown = JSON.parse(run('run-require.cjs'))
  // Assert
  assert.deepEqual(result, {
    origin: 'packed',
    subOrigin: 'packed-sub',
    dep: 'library-dependency',
    other: 'other',
    samePeer: true,
    hidden: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  })
  await library.dispose()
})

// protects=the Example's own node_modules/<name> is read-only for the whole run; fails_when=a path, size or link target under the Example's node_modules differs afterwards; no_claim=other folders of the repository (the source snapshot covers them)
test('leaves the Example node_modules byte for byte as it was after a run', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  const before = listFolderState(
    join(fixture.examplePackageRoot, 'node_modules'),
  )
  // Act
  run('run-import.mjs')
  run('run-require.cjs')
  const after = listFolderState(
    join(fixture.examplePackageRoot, 'node_modules'),
  )
  // Assert
  assert.deepEqual(after, before)
  await library.dispose()
})

// protects=a run that loads the packed copy reads loaded with a complete observation and no other copy; fails_when=loads are not counted, or the observation is incomplete after a normal exit; no_claim=what a killed process leaves
test('observes loads of the packed copy with a complete observation after a normal exit', async () => {
  // Arrange
  const { library, run } = await prepared()
  run('run-import.mjs')
  // Act
  const observed = await library.finishObservation()
  // Assert
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.loaded, true)
  assert.equal(observed.otherCopyLoaded, false)
  assert.ok(observed.loadCount >= 2)
  await library.dispose()
})

// protects=a script that only calls require.resolve on the package reads not loaded; fails_when=a resolution is counted as a load; no_claim=none beyond protects
test('reads a script that only resolves the package as not loaded', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  // Act
  const printed = run('run-resolve-only.cjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(
    printed.startsWith(join(fixture.privateFolder, 'node_modules', 'lib')),
    true,
  )
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.loaded, false)
  assert.equal(observed.loadCount, 0)
  await library.dispose()
})

// protects=a script that loads the Example's installed copy by path is reported as another copy loaded; fails_when=the published copy loads unnoticed; no_claim=copies of other package names
test('reports the published copy loaded by path as another copy', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  // Act
  const printed = run('run-published-by-path.mjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(printed, 'published')
  assert.equal(observed.otherCopyLoaded, true)
  assert.equal(
    observed.otherCopyPath,
    join(
      fixture.examplePackageRoot,
      'node_modules',
      'lib',
      'dist',
      'index.mjs',
    ),
  )
  await library.dispose()
})

// protects=a truncated observation file is incomplete and a missing one unreadable, never a negative; fails_when=a cut line or a missing closing line reads complete or not loaded; no_claim=none beyond protects
test('reads a truncated observation as incomplete and a missing file as unreadable', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  run('run-import.mjs')
  const observationFile = join(
    fixture.privateFolder,
    'library-observation.jsonl',
  )
  writeFileSync(
    observationFile,
    '{"event":"start"}\n{"event":"load","path":"/p/a.mjs"}\n{"event":"loa',
  )
  // Act
  const truncated = await library.finishObservation()
  writeFileSync(
    observationFile,
    '{"event":"start"}\n{"event":"load","path":"/p/a.mjs"}\n',
  )
  const withoutClosing = await library.finishObservation()
  await library.dispose()
  const missing = await library.finishObservation()
  // Assert
  assert.equal(truncated.observation, 'incomplete')
  assert.equal(truncated.loadCount, 1)
  assert.equal(withoutClosing.observation, 'incomplete')
  assert.equal(missing.observation, 'unreadable')
})
