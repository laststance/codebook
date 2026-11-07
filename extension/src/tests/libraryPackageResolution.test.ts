import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

// protects=a # alias in the packed imports map that targets another package resolves like that package imported directly (a dependency from the library's install, a peer from the Example, a conditions object under import and require) while a relative target stays inside the packed copy; fails_when=Node resolves the alias from the private folder, where only the library exists, and the run fails with ERR_MODULE_NOT_FOUND; no_claim=pattern keys and array targets (not exercised here)
test('resolves a # alias to another package like that package imported directly from the packed copy', async () => {
  // Arrange
  const { fixture, library, run } = await prepared((prepareFixture) => {
    const manifestPath = join(prepareFixture.libraryRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    manifest.imports = {
      '#dep': 'dep',
      '#peer': 'peer',
      '#internal': './dist/internal.mjs',
      '#cond': { require: 'dep', default: 'dep' },
    }
    manifest.exports = {
      ...(manifest.exports as Record<string, unknown>),
      './aliases': {
        import: './dist/aliases.mjs',
        require: './dist/aliases.cjs',
      },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    writeAt(
      join(prepareFixture.libraryRoot, 'dist', 'internal.mjs'),
      "export const value = 'packed-internal'\n",
    )
    writeAt(
      join(prepareFixture.libraryRoot, 'dist', 'aliases.mjs'),
      [
        "import dep from '#dep'",
        "import peer from '#peer'",
        "import cond from '#cond'",
        "import { value } from '#internal'",
        'export { dep, peer, cond, value }',
        '',
      ].join('\n'),
    )
    writeAt(
      join(prepareFixture.libraryRoot, 'dist', 'aliases.cjs'),
      [
        "const dep = require('#dep')",
        "const peer = require('#peer')",
        "const cond = require('#cond')",
        'module.exports = { dep, peer, cond }',
        '',
      ].join('\n'),
    )
  })
  writeAt(
    join(fixture.examplePackageRoot, 'run-aliases.mjs'),
    [
      "import { createRequire } from 'node:module'",
      "import * as aliases from 'lib/aliases'",
      "import examplePeer from 'peer'",
      "const required = createRequire(import.meta.url)('lib/aliases')",
      'console.log(JSON.stringify({',
      '  dep: aliases.dep.name,',
      '  samePeer: aliases.peer === examplePeer,',
      '  cond: aliases.cond.name,',
      '  value: aliases.value,',
      '  requiredDep: required.dep.name,',
      '  requiredPeer: required.peer === examplePeer,',
      '  requiredCond: required.cond.name,',
      '}))',
      '',
    ].join('\n'),
  )
  // Act
  const result: unknown = JSON.parse(run('run-aliases.mjs'))
  // Assert
  assert.deepEqual(result, {
    dep: 'library-dependency',
    samePeer: true,
    cond: 'library-dependency',
    value: 'packed-internal',
    requiredDep: 'library-dependency',
    requiredPeer: true,
    requiredCond: 'library-dependency',
  })
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

/** The child scripts of the fork tests: one that loads nothing, one that loads the packed copy, one that kills itself. */
function writeForkScripts(root: string): void {
  writeAt(join(root, 'child-idle.mjs'), '1 + 1\n')
  writeAt(join(root, 'child-packed.mjs'), "await import('lib')\n")
  writeAt(
    join(root, 'child-killed.mjs'),
    "process.kill(process.pid, 'SIGKILL')\n",
  )
}

/** A parent script that runs `loadLine`, then forks `child` (which inherits --import) and waits for it. */
function forkParent(loadLine: string, child: string): string {
  return [
    "import { fork } from 'node:child_process'",
    loadLine,
    `await new Promise((resolve) => fork(new URL('./${child}', import.meta.url)).on('exit', resolve))`,
    '',
  ].join('\n')
}

// protects=a forked child that inherits --import neither truncates the parent's records nor closes the observation alone; fails_when=the child's hook resets the file so the parent's load vanishes; no_claim=resolution inside the child
test('keeps the parent load when a forked child that loads nothing exits', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  writeForkScripts(fixture.examplePackageRoot)
  writeAt(
    join(fixture.examplePackageRoot, 'run-fork-idle.mjs'),
    forkParent("await import('lib')", 'child-idle.mjs'),
  )
  // Act
  run('run-fork-idle.mjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.loaded, true)
  assert.equal(observed.loadCount, 1)
  await library.dispose()
})

// protects=another copy loaded by the parent survives a forked child that loads the packed copy; fails_when=the child's truncation drops the parent's other-copy line; no_claim=none beyond protects
test('keeps the other copy the parent loaded when a forked child loads the packed copy', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  writeForkScripts(fixture.examplePackageRoot)
  writeAt(
    join(fixture.examplePackageRoot, 'run-fork-packed.mjs'),
    forkParent(
      "await import(new URL('./node_modules/lib/dist/index.mjs', import.meta.url))",
      'child-packed.mjs',
    ),
  )
  // Act
  run('run-fork-packed.mjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(observed.observation, 'complete')
  assert.equal(observed.otherCopyLoaded, true)
  assert.equal(observed.loaded, true)
  await library.dispose()
})

// protects=a forked child killed by SIGKILL leaves the observation incomplete; fails_when=the parent's closing line alone makes the run complete; no_claim=what the child loaded
test('reads the observation as incomplete when a forked child is killed', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  writeForkScripts(fixture.examplePackageRoot)
  writeAt(
    join(fixture.examplePackageRoot, 'run-fork-killed.mjs'),
    forkParent("await import('lib')", 'child-killed.mjs'),
  )
  // Act
  run('run-fork-killed.mjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(observed.observation, 'incomplete')
  assert.equal(observed.loaded, true)
  await library.dispose()
})

// protects=a write error of the hook never reaches the script, and the observation then reads incomplete; fails_when=the script's import throws, the exit code is not 0, or the observation reads complete; no_claim=Windows permissions
test('keeps the script running when the observation file cannot be written and reads it as incomplete', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  chmodSync(join(fixture.privateFolder, 'library-observation.jsonl'), 0o444)
  // Act
  const printed = run('run-import.mjs')
  const observed = await library.finishObservation()
  // Assert
  assert.equal(JSON.parse(printed).origin, 'packed')
  assert.equal(observed.observation, 'incomplete')
  await library.dispose()
})

// protects=a process stops writing once it passed the configured byte limit, closing line included; fails_when=the file keeps growing or the run reads complete; no_claim=the limit value
test('stops writing past the observation byte limit and reads the observation as incomplete', async () => {
  // Arrange
  const { fixture, library, run } = await prepared()
  const hookFile = join(fixture.privateFolder, 'library-hook.mjs')
  writeFileSync(
    hookFile,
    readFileSync(hookFile, 'utf8').replace(
      /"observationLimitBytes":\d+/,
      '"observationLimitBytes":60',
    ),
  )
  // Act
  run('run-import.mjs')
  const observed = await library.finishObservation()
  const size = readFileSync(
    join(fixture.privateFolder, 'library-observation.jsonl'),
  ).length
  // Assert
  assert.equal(observed.observation, 'incomplete')
  assert.equal(size <= 60, true)
  await library.dispose()
})

// protects=a dynamic import of a packed JSON file imported without its attribute and caught is not counted as a load; fails_when=the load is recorded before it succeeds; no_claim=the error text
test('does not count a caught failing import of a packed file as a load', async () => {
  // Arrange
  const { fixture, library } = await prepared()
  const packedBroken = join(
    fixture.privateFolder,
    'node_modules',
    'lib',
    'dist',
    'broken.json',
  )
  writeAt(packedBroken, '{}\n')
  writeAt(
    join(fixture.examplePackageRoot, 'run-broken.mjs'),
    [
      "import { pathToFileURL } from 'node:url'",
      "try { await import(pathToFileURL(process.argv[2]).href) } catch { console.log('caught') }",
      '',
    ].join('\n'),
  )
  // Act
  const printed = execFileSync(
    process.execPath,
    [...library.nodeArguments, 'run-broken.mjs', packedBroken],
    { cwd: fixture.examplePackageRoot, encoding: 'utf8' },
  ).trim()
  const observed = await library.finishObservation()
  // Assert
  assert.equal(printed, 'caught')
  assert.equal(observed.loadCount, 0)
  assert.equal(observed.observation, 'complete')
  await library.dispose()
})
