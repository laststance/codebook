import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

type LibraryFixture = ReturnType<typeof createLibraryFixture>

/** Writes a file, creating its folder. */
function writeAt(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

/** Prepares the fixture library (fake build and pack, real tarball) and returns it with a runner that starts the real `node` with the hook. */
async function prepared(beforePack?: (fixture: LibraryFixture) => void) {
  const fixture = createLibraryFixture()
  beforePack?.(fixture)
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
  // run-import.mjs loads the library's index and its sub module; the hidden subpath fails and mid is not part of the packed copy.
  assert.equal(observed.loadCount, 2)
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

// protects=a package-internal `#` import inside the packed copy resolves through the packed package.json imports map; fails_when=the hook treats the # specifier as a bare package and resolves it through the library source folder's imports map; no_claim=CommonJS require of a # import
test('resolves a # import inside the packed copy through the packed imports map, not the library source', async () => {
  // Arrange
  const { fixture, library, run } = await prepared((prepareFixture) => {
    const manifestPath = join(prepareFixture.libraryRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    manifest.imports = { '#internal': './dist/internal.mjs' }
    manifest.exports = {
      ...(manifest.exports as Record<string, unknown>),
      './inner': { import: './dist/inner.mjs' },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    writeAt(
      join(prepareFixture.libraryRoot, 'dist', 'internal.mjs'),
      "export const value = 'packed-internal'\n",
    )
    writeAt(
      join(prepareFixture.libraryRoot, 'dist', 'inner.mjs'),
      "import { value } from '#internal'\nexport const inner = value\n",
    )
  })
  // The library source folder's imports map points elsewhere after the pack.
  const manifestPath = join(fixture.libraryRoot, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >
  manifest.imports = { '#internal': './src/decoy.mjs' }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  writeAt(
    join(fixture.libraryRoot, 'src', 'decoy.mjs'),
    "export const value = 'source-decoy'\n",
  )
  writeAt(
    join(fixture.examplePackageRoot, 'run-inner.mjs'),
    "import { inner } from 'lib/inner'\nconsole.log(inner)\n",
  )
  // Act
  const printed = run('run-inner.mjs')
  // Assert
  assert.equal(printed, 'packed-internal')
  await library.dispose()
})

// protects=an Example outside node_modules whose package has no name (the layout where the library is the repository root) never counts as another copy of the library; fails_when=the name lookup climbs from the Example to the library's root manifest and reports the Example's own files as another copy; no_claim=copies installed under node_modules
test('does not report a nameless Example under a library root as another copy', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  writeFileSync(
    join(fixture.repositoryRoot, 'package.json'),
    JSON.stringify({ name: 'lib', private: true }),
  )
  writeFileSync(
    join(fixture.examplePackageRoot, 'package.json'),
    JSON.stringify({ private: true }),
  )
  writeAt(
    join(fixture.examplePackageRoot, 'local.mjs'),
    "export const local = 'local'\n",
  )
  writeAt(
    join(fixture.examplePackageRoot, 'run-local.mjs'),
    "import { local } from './local.mjs'\nconsole.log(local)\n",
  )
  // Act
  const printed = run('run-local.mjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(printed, 'local')
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.otherCopyLoaded, false)
  await library.dispose()
})

// protects=a worker thread started by the script (it inherits --import) neither truncates the main thread's observation nor writes its closing line; fails_when=the worker's copy of the hook resets the file so earlier loads vanish or a worker exit closes the observation early; no_claim=resolution inside the worker
test('keeps the main thread observation whole when the script starts a worker thread', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  writeAt(join(fixture.examplePackageRoot, 'worker.mjs'), '1 + 1\n')
  writeAt(
    join(fixture.examplePackageRoot, 'run-worker.mjs'),
    [
      "import { Worker } from 'node:worker_threads'",
      "import { origin } from 'lib'",
      "await new Promise((resolve) => new Worker(new URL('./worker.mjs', import.meta.url)).on('exit', resolve))",
      'console.log(origin)',
      '',
    ].join('\n'),
  )
  // Act
  const printed = run('run-worker.mjs')
  const observed = await library.finishObservation()
  const lines = readFileSync(
    join(fixture.privateFolder, 'library-observation.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { event: string }).event)
  // Assert
  assert.equal(printed, 'packed')
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.loaded, true)
  assert.equal(observed.loadCount, 1)
  assert.deepEqual(
    lines.filter((event) => event === 'start' || event === 'closing'),
    ['start', 'closing'],
  )
  await library.dispose()
})
