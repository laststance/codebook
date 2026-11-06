import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { LIBRARY_BUILD_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import {
  LibraryPackageCancelled,
  prepareLibraryPackage,
  type LibraryPackageDependencies,
} from '../libraryPackage'

import {
  createLibraryClock,
  createLibraryFixture,
  createRouteSpawner,
  EVERY_PATH_IS_A_PROGRAM,
  FIXTURE_NODE,
  type FixtureOptions,
  type RouteScript,
} from './utils/libraryRouteFixture'
import { writeTestTarball } from './utils/writeTestTarball'

/** Prepares the library of a fixture with fake processes; returns what a test asserts on. */
function setUp(
  options: FixtureOptions = {},
  script: RouteScript = {},
  overrides: Partial<LibraryPackageDependencies> = {},
  mutateConfiguration?: (packageRoot: string) => string,
) {
  const fixture = createLibraryFixture(options)
  const route = createRouteSpawner(fixture.libraryRoot, script)
  const clock = createLibraryClock()
  const controller = new AbortController()
  const configuration = {
    library: {
      packageRoot:
        mutateConfiguration?.(fixture.configuration.library.packageRoot) ??
        fixture.configuration.library.packageRoot,
    },
  }
  const prepare = () =>
    prepareLibraryPackage(configuration, fixture.roots, {
      node: FIXTURE_NODE,
      signal: controller.signal,
      clock,
      spawner: route.spawner,
      isProgramFile: EVERY_PATH_IS_A_PROGRAM,
      hostEnvironment: { PATH: '/usr/bin' },
      ...overrides,
    })
  return { fixture, route, clock, controller, prepare }
}

/** Awaits a rejection and returns the typed error. */
async function errorOf(promise: Promise<unknown>): Promise<StudyError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StudyError) return error
    throw error
  }
  throw new Error('Expected the library route to raise a StudyError.')
}

/** Waits until the library route has started a process; the snapshot and Git reads before it take real time. */
async function untilSpawned(route: { requests: unknown[] }): Promise<void> {
  while (route.requests.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 5))
}

/** Lets pending continuations run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++)
    await new Promise((resolve) => setImmediate(resolve))
}

// protects=a library folder that leaves the repository, by name or through a link, is refused before any process; fails_when=the build starts or another reason is given; no_claim=the wording
test('refuses a library folder outside the repository, also through a link, before any process starts', async () => {
  // Arrange
  const direct = setUp({}, {}, {}, () => '../outside')
  const throughLink = setUp()
  const outside = join(
    throughLink.fixture.repositoryRoot,
    '..',
    'outside-library',
  )
  mkdirSync(outside, { recursive: true })
  symlinkSync(
    outside,
    join(throughLink.fixture.repositoryRoot, 'packages', 'linked'),
  )
  // Act
  const directError = await errorOf(direct.prepare())
  const linkedError = await errorOf(
    prepareLibraryPackage(
      { library: { packageRoot: 'packages/linked' } },
      throughLink.fixture.roots,
      {
        node: FIXTURE_NODE,
        signal: throughLink.controller.signal,
        spawner: throughLink.route.spawner,
        isProgramFile: EVERY_PATH_IS_A_PROGRAM,
        hostEnvironment: { PATH: '/usr/bin' },
      },
    ),
  )
  // Assert
  assert.equal(directError.code, 'LIBRARY_BUILD_UNSUPPORTED')
  assert.equal(directError.details?.reason, 'outside-repository')
  assert.equal(directError.details?.field, 'configuration.library.packageRoot')
  assert.equal(linkedError.details?.reason, 'outside-repository')
  assert.equal(direct.route.requests.length, 0)
  assert.equal(throughLink.route.requests.length, 0)
})

// protects=a library folder equal to or inside the Example is refused while an ancestor is accepted elsewhere; fails_when=the Example's own folder is built as its library; no_claim=none beyond protects
test('refuses the Example folder and a folder inside it as the library', async () => {
  // Arrange
  const same = setUp({}, {}, {}, () => 'examples/node')
  const inside = setUp({}, {}, {}, () => 'examples/node/node_modules/lib')
  // Act
  const sameError = await errorOf(same.prepare())
  const insideError = await errorOf(inside.prepare())
  // Assert
  assert.equal(sameError.details?.reason, 'inside-example')
  assert.equal(insideError.details?.reason, 'inside-example')
  assert.equal(same.route.requests.length, 0)
})

// protects=a folder without a package.json name is refused as not-a-package; fails_when=it is built; no_claim=none beyond protects
test('refuses a library folder whose package.json has no name', async () => {
  // Arrange
  const { route, prepare } = setUp({ libraryHasName: false })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'not-a-package')
  assert.equal(route.requests.length, 0)
})

// protects=a library the Example does not depend on is refused with the package name; fails_when=the Example runs on a library it never imports; no_claim=that the Example imports it
test('refuses a library that the Example does not depend on', async () => {
  // Arrange
  const { route, prepare } = setUp({ exampleDependsOnLibrary: false })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'not-a-dependency')
  assert.equal(error.details?.package, 'lib')
  assert.equal(route.requests.length, 0)
})

// protects=a library without a build script is refused; fails_when=a build is attempted with no script; no_claim=none beyond protects
test('refuses a library with no build script', async () => {
  // Arrange
  const { route, prepare } = setUp({ hasBuildScript: false })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'no-build-script')
  assert.equal(route.requests.length, 0)
})

// protects=Yarn declared in packageManager is refused as unsupported; fails_when=the build runs with another manager; no_claim=none beyond protects
test('refuses a repository whose packageManager field names Yarn', async () => {
  // Arrange
  const { route, prepare } = setUp({ packageManagerField: 'yarn@4.1.0' })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'package-manager-unsupported')
  assert.equal(error.details?.packageManager, 'yarn@4.1.0')
  assert.equal(route.requests.length, 0)
})

// protects=two lockfiles and no packageManager field are refused as unknown; fails_when=a manager is guessed; no_claim=none beyond protects
test('refuses a repository with both lockfiles and no packageManager field', async () => {
  // Arrange
  const { route, prepare } = setUp({
    packageManagerField: null,
    lockfiles: ['pnpm-lock.yaml', 'package-lock.json'],
  })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'package-manager-unknown')
  assert.equal(route.requests.length, 0)
})

// protects=a manager that is not on the run's PATH is refused as missing; fails_when=the build is spawned without the manager; no_claim=none beyond protects
test('refuses a repository whose package manager is not on the PATH', async () => {
  // Arrange
  const { route, prepare } = setUp(
    {},
    {},
    { isProgramFile: () => Promise.resolve(false) },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'package-manager-missing')
  assert.equal(error.details?.packageManager, 'pnpm')
  assert.equal(route.requests.length, 0)
})

// protects=a library whose dependency is not installed is refused with the install command; fails_when=the build runs on missing dependencies; no_claim=devDependencies the build needs
test('refuses a library whose dependency is not installed and names the install command', async () => {
  // Arrange
  const { route, prepare } = setUp({ installDependency: false })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'library-not-installed')
  assert.equal(error.details?.package, 'dep')
  assert.equal(error.details?.installCommand, 'pnpm install')
  assert.equal(route.requests.length, 0)
})

// protects=a peer the Example cannot resolve is refused; fails_when=the packed library loads a peer that the Example lacks; no_claim=optional peers
test('refuses a library whose peer the Example does not have installed', async () => {
  // Arrange
  const { route, prepare } = setUp({ installPeer: false })
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'peer-not-installed')
  assert.equal(error.details?.package, 'peer')
  assert.equal(route.requests.length, 0)
})

// protects=an external Node below 24 is refused; fails_when=the build runs on Node 22; no_claim=none beyond protects
test('refuses an external Node below 24', async () => {
  // Arrange
  const { route, prepare } = setUp(
    {},
    {},
    { node: { executable: process.execPath, version: '22.4.0' } },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'node-version')
  assert.equal(error.details?.nodeVersion, '22.4.0')
  assert.equal(route.requests.length, 0)
})

// protects=the build runs pnpm run build in the library folder and the pack runs with scripts off into the private folder, nothing builds twice; fails_when=another command, folder or a prepack-driven second build is started; no_claim=that real pnpm skips prepack (checked in E1)
test('builds then packs with scripts off and starts exactly two processes', async () => {
  // Arrange
  const { fixture, route, clock, prepare } = setUp(
    {},
    {
      onBuild: (control) => {
        clock.tick(1200)
        control.exit({ code: 0, signal: null })
      },
      onPack: (control) => {
        clock.tick(300)
        writeTestTarball(
          { 'package.json': '{"name":"lib","version":"2.0.0"}' },
          join(fixture.privateFolder, 'lib-2.0.0.tgz'),
        )
        control.exit({ code: 0, signal: null })
      },
    },
  )
  // Act
  const library = await prepare()
  // Assert
  assert.deepEqual(
    route.requests.map((request) => request.arguments),
    [
      ['run', 'build'],
      [
        'pack',
        '--pack-destination',
        fixture.privateFolder,
        '--config.ignore-scripts=true',
      ],
    ],
  )
  assert.deepEqual(
    route.requests.map((request) => request.cwd),
    [fixture.libraryRoot, fixture.libraryRoot],
  )
  assert.equal(library.facts.buildMs, 1200)
  assert.equal(library.facts.packMs, 300)
  assert.equal(library.facts.package, 'lib')
  assert.equal(library.facts.version, '2.0.0')
  assert.equal(library.facts.revision, fixture.revision)
  assert.equal(library.facts.dirty, false)
  assert.deepEqual(library.facts.packageManager, {
    name: 'pnpm',
    version: '11.23.0',
  })
  assert.equal(library.facts.installedVersion, '1.0.0')
  assert.match(library.facts.tarballSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(library.nodeArguments.slice(0, 1), ['--import'])
  assert.match(library.nodeArguments[1] ?? '', /^file:\/\/.*library-hook\.mjs$/)
  await library.dispose()
})

// protects=npm packs with --ignore-scripts; fails_when=the pnpm flag is sent to npm; no_claim=none beyond protects
test('packs with npm using its own ignore-scripts flag', async () => {
  // Arrange
  const { fixture, route, prepare } = setUp({
    packageManagerField: 'npm@10.9.0',
  })
  // Act
  const library = await prepare()
  // Assert
  assert.deepEqual(route.requests[1]?.arguments, [
    'pack',
    '--pack-destination',
    fixture.privateFolder,
    '--ignore-scripts',
  ])
  assert.deepEqual(library.facts.packageManager, {
    name: 'npm',
    version: '10.9.0',
  })
  await library.dispose()
})

// protects=a library folder with uncommitted changes is reported dirty; fails_when=dirty stays false; no_claim=ignored files
test('reports the library as dirty when an untracked file lies in its folder', async () => {
  // Arrange
  const { fixture, prepare } = setUp()
  writeFileSync(join(fixture.libraryRoot, 'src', 'notes.ts'), 'export {}\n')
  // Act
  const library = await prepare()
  // Assert
  assert.equal(library.facts.dirty, true)
  await library.dispose()
})

// protects=the private folder is gone after a successful run once disposed; fails_when=the tarball or the unpacked package stays; no_claim=removal of anything outside the private folder
test('removes the private folder on dispose after a successful run', async () => {
  // Arrange
  const { fixture, prepare } = setUp()
  const library = await prepare()
  assert.equal(
    existsSync(join(fixture.privateFolder, 'node_modules', 'lib')),
    true,
  )
  // Act
  const cleanup = await library.dispose()
  // Assert
  assert.deepEqual(cleanup, { cleanup: 'removed' })
  assert.equal(existsSync(fixture.privateFolder), false)
})

// protects=a build that exits with an error is build-error with its last masked lines, runs no pack and leaves no private folder; fails_when=the pack starts, the lines are lost or the folder stays; no_claim=none beyond protects
test('reports a failed build as build-error, starts no pack and removes the private folder', async () => {
  // Arrange
  const { fixture, route, prepare } = setUp(
    {},
    {
      onBuild: (control) => {
        control.output('tsc: error TS2304\n')
        control.exit({ code: 2, signal: null })
      },
    },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.code, 'LIBRARY_BUILD_FAILED')
  assert.equal(error.details?.reason, 'build-error')
  assert.equal(error.details?.exitCode, 2)
  assert.equal(error.details?.command, 'pnpm run build in packages/lib')
  assert.match(error.message, /tsc: error TS2304/)
  assert.equal(route.requests.length, 1)
  assert.equal(existsSync(fixture.privateFolder), false)
  assert.equal(error.details?.cleanup, 'removed')
})

// protects=a build past the shared budget has its tree ended and reads timeout; fails_when=the build is waited for forever or reads build-error; no_claim=real elapsed time
test('ends a build past the library time limit and reports timeout', async () => {
  // Arrange
  const { route, clock, prepare } = setUp({}, { onBuild: () => undefined })
  // Act
  const pending = errorOf(prepare())
  await untilSpawned(route)
  await clock.advance(LIBRARY_BUILD_TIMEOUT_MS)
  const error = await pending
  // Assert
  assert.equal(error.details?.reason, 'timeout')
  assert.deepEqual(route.signals, ['SIGTERM'])
})

// protects=a pack that exits non-zero is pack-error with step pack; fails_when=another reason or step; no_claim=none beyond protects
test('reports a failed pack as pack-error with step pack', async () => {
  // Arrange
  const { fixture, prepare } = setUp(
    {},
    { onPack: (control) => control.exit({ code: 1, signal: null }) },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'pack-error')
  assert.equal(error.details?.step, 'pack')
  assert.equal(existsSync(fixture.privateFolder), false)
})

// protects=a pack that leaves no tarball is pack-error with step tarball; fails_when=the run goes on without a package; no_claim=none beyond protects
test('reports a pack that left no tarball as pack-error with step tarball', async () => {
  // Arrange
  const { prepare } = setUp(
    {},
    { onPack: (control) => control.exit({ code: 0, signal: null }) },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'pack-error')
  assert.equal(error.details?.step, 'tarball')
})

// protects=a tarball that cannot be unpacked is pack-error with step unpack; fails_when=a half package is used; no_claim=none beyond protects
test('reports a tarball that is not an archive as pack-error with step unpack', async () => {
  // Arrange
  const { fixture, prepare } = setUp(
    {},
    {
      onPack: (control) => {
        writeFileSync(join(fixture.privateFolder, 'lib-2.0.0.tgz'), 'not gzip')
        control.exit({ code: 0, signal: null })
      },
    },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'pack-error')
  assert.equal(error.details?.step, 'unpack')
})

// protects=a tarball of another package is pack-error with step metadata; fails_when=another package is run as the library; no_claim=none beyond protects
test('reports a tarball whose package.json names another package as pack-error with step metadata', async () => {
  // Arrange
  const { fixture, prepare } = setUp(
    {},
    {
      onPack: (control) => {
        writeTestTarball(
          { 'package.json': '{"name":"other","version":"1.0.0"}' },
          join(fixture.privateFolder, 'other-1.0.0.tgz'),
        )
        control.exit({ code: 0, signal: null })
      },
    },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'pack-error')
  assert.equal(error.details?.step, 'metadata')
})

// protects=a HEAD that moves during the build is source-changed with before and after; fails_when=the run claims the revision read before the build; no_claim=none beyond protects
test('reports a HEAD that moved during the build as source-changed', async () => {
  // Arrange
  let reads = 0
  const { fixture, prepare } = setUp(
    {},
    {},
    {
      readRevision: () =>
        Promise.resolve(++reads === 1 ? 'a'.repeat(40) : 'b'.repeat(40)),
    },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'source-changed')
  assert.deepEqual(error.details?.revision, {
    before: 'a'.repeat(40),
    after: 'b'.repeat(40),
  })
  assert.equal(existsSync(fixture.privateFolder), false)
})

// protects=a build that changes a tracked file and then fails is tracked-file-changed, not build-error; fails_when=the build error wins; no_claim=restoring the file
test('reports a tracked file changed by a failing build as tracked-file-changed', async () => {
  // Arrange
  const changing = setUp(
    {},
    {
      onBuild: (control) => {
        writeFileSync(
          join(changing.fixture.libraryRoot, 'src', 'index.ts'),
          'changed\n',
        )
        control.exit({ code: 1, signal: null })
      },
    },
  )
  // Act
  const error = await errorOf(changing.prepare())
  // Assert
  assert.equal(error.details?.reason, 'tracked-file-changed')
  assert.equal(error.details?.path, 'packages/lib/src/index.ts')
})

// protects=an untracked source file written during the build counts as a change; fails_when=only tracked files are compared; no_claim=ignored files
test('reports an untracked file created during the build as tracked-file-changed', async () => {
  // Arrange
  const created = setUp(
    {},
    {
      onBuild: (control) => {
        writeFileSync(
          join(created.fixture.repositoryRoot, 'generated.ts'),
          'x\n',
        )
        control.exit({ code: 0, signal: null })
      },
    },
  )
  // Act
  const error = await errorOf(created.prepare())
  // Assert
  assert.equal(error.details?.reason, 'tracked-file-changed')
  assert.equal(error.details?.path, 'generated.ts')
})

// protects=a tracked-file change outranks a moved HEAD, a timeout and a build error; fails_when=a lower reason wins; no_claim=none beyond protects
test('reports tracked-file-changed before source-changed when both happened', async () => {
  // Arrange
  let reads = 0
  const both = setUp(
    {},
    {
      onBuild: (control) => {
        writeFileSync(
          join(both.fixture.libraryRoot, 'src', 'index.ts'),
          'changed\n',
        )
        control.exit({ code: 1, signal: null })
      },
    },
    {
      readRevision: () =>
        Promise.resolve(++reads === 1 ? 'a'.repeat(40) : 'b'.repeat(40)),
    },
  )
  // Act
  const error = await errorOf(both.prepare())
  // Assert
  assert.equal(error.details?.reason, 'tracked-file-changed')
})

// protects=a moved HEAD outranks a failing build; fails_when=build-error hides the moved HEAD; no_claim=none beyond protects
test('reports source-changed before build-error when both happened', async () => {
  // Arrange
  let reads = 0
  const { prepare } = setUp(
    {},
    { onBuild: (control) => control.exit({ code: 1, signal: null }) },
    {
      readRevision: () =>
        Promise.resolve(++reads === 1 ? 'a'.repeat(40) : 'b'.repeat(40)),
    },
  )
  // Act
  const error = await errorOf(prepare())
  // Assert
  assert.equal(error.details?.reason, 'source-changed')
})

// protects=a stop that finds the sources unchanged ends the build and raises the cancellation for the caller's stop error; fails_when=a build error or success is reported, or the folder stays; no_claim=the stop error's wording (the caller commits it)
test('ends a stopped build, removes the private folder and raises the cancellation', async () => {
  // Arrange
  const { fixture, route, controller, prepare } = setUp(
    {},
    { onBuild: () => undefined },
  )
  // Act
  const pending = prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  await untilSpawned(route)
  controller.abort()
  const outcome = await pending
  // Assert
  assert.ok(outcome instanceof LibraryPackageCancelled)
  assert.equal(outcome.cleanup, 'removed')
  assert.deepEqual(route.signals, ['SIGTERM'])
  assert.equal(existsSync(fixture.privateFolder), false)
})

// protects=a stop during a build that had changed a tracked file reports tracked-file-changed; fails_when=the stop hides the change; no_claim=none beyond protects
test('reports tracked-file-changed when a stopped build had changed a tracked file', async () => {
  // Arrange
  const stopped = setUp(
    {},
    {
      onBuild: () =>
        writeFileSync(
          join(stopped.fixture.libraryRoot, 'src', 'index.ts'),
          'changed\n',
        ),
    },
  )
  // Act
  const pending = errorOf(stopped.prepare())
  await untilSpawned(stopped.route)
  stopped.controller.abort()
  const error = await pending
  // Assert
  assert.equal(error.details?.reason, 'tracked-file-changed')
})

// protects=a stop whose process tree cannot be confirmed ended is tracked-files-unverified and the folder removal stays pending; fails_when=the sources are called verified or the folder is removed under a live tree; no_claim=that the tree ends later
test('reports tracked-files-unverified and a pending cleanup when the stopped tree is not confirmed ended', async () => {
  // Arrange
  const stuck = setUp({}, { onBuild: () => undefined, endsOn: 'never' })
  // Act
  const pending = errorOf(stuck.prepare())
  await untilSpawned(stuck.route)
  stuck.controller.abort()
  await settle()
  await stuck.clock.advance(5_000)
  await stuck.clock.advance(5_000)
  const error = await pending
  // Assert
  assert.equal(error.details?.reason, 'tracked-files-unverified')
  assert.equal(error.details?.cleanup, 'pending')
  assert.deepEqual(stuck.route.signals, ['SIGTERM', 'SIGKILL', 'SIGKILL'])
  assert.equal(existsSync(stuck.fixture.privateFolder), true)
  rmSync(stuck.fixture.privateFolder, { recursive: true, force: true })
})
