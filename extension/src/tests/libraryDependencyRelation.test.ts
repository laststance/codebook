import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  prepareLibraryCore,
  type LibraryPackageDependencies,
} from '../libraryPackage'
import {
  assertLibraryRouteSupported,
  type LibraryDependencyRelation,
} from '../utils/assertLibraryRouteSupported'

import {
  createLibraryClock,
  createLibraryFixture,
  createRouteSpawner,
  EVERY_PATH_IS_A_PROGRAM,
  FIXTURE_NODE,
} from './utils/libraryRouteFixture'

type Fixture = ReturnType<typeof createLibraryFixture>

/** Writes the installed manifest of a package in the Example's `node_modules` (untracked, like a real install). */
function installManifest(
  fixture: Fixture,
  name: string,
  manifest: Record<string, unknown>,
): void {
  const folder = join(fixture.examplePackageRoot, 'node_modules', name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...manifest }),
  )
}

/** Lists exactly these dependencies in the Example's package.json and commits the change, so the repository stays clean. */
function listDependencies(fixture: Fixture, names: string[]): void {
  writeFileSync(
    join(fixture.examplePackageRoot, 'package.json'),
    JSON.stringify({
      name: 'example',
      private: true,
      dependencies: Object.fromEntries(names.map((name) => [name, '1.0.0'])),
    }),
  )
  fixture.git('add', '-A')
  fixture.git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '-m',
    'list dependencies',
  )
}

/** Runs the pre-build checks of the fixture's library with the given relation. */
function check(
  fixture: Fixture,
  dependencyRelation?: LibraryDependencyRelation,
) {
  return assertLibraryRouteSupported({
    repositoryRoot: fixture.repositoryRoot,
    examplePackageRoot: fixture.examplePackageRoot,
    declaredPackageRoot: 'packages/lib',
    node: FIXTURE_NODE,
    pathText: '/usr/bin',
    isProgramFile: EVERY_PATH_IS_A_PROGRAM,
    dependencyRelation,
  })
}

/** Runs the shared build core of the fixture's library with a fake build and the real tarball of the library folder. */
function prepareCore(
  fixture: Fixture,
  dependencyRelation?: LibraryDependencyRelation,
) {
  const dependencies: LibraryPackageDependencies = {
    node: FIXTURE_NODE,
    signal: new AbortController().signal,
    clock: createLibraryClock(),
    spawner: createRouteSpawner(fixture.libraryRoot).spawner,
    isProgramFile: EVERY_PATH_IS_A_PROGRAM,
    hostEnvironment: { PATH: '/usr/bin' },
    dependencyRelation,
  }
  return prepareLibraryCore('packages/lib', fixture.roots, dependencies)
}

/** The details of the refusal a promise ends in, or `undefined` when it resolves. */
async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ message: string; details: Record<string, unknown> } | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return {
      message: error.message,
      details: Reflect.get(error, 'details') as Record<string, unknown>,
    }
  }
}

// protects=an Example that lists the library itself states no relation under either option; fails_when=a direct listing reports reachedThrough or is refused; no_claim=a transitive Example
test('an Example that lists the library reports no reachedThrough', async () => {
  // Arrange
  const fixture = createLibraryFixture()
  // Act
  const direct = await check(fixture, 'direct')
  const either = await check(fixture, 'direct-or-installed')
  // Assert
  assert.equal(direct.reachedThrough, undefined)
  assert.equal(either.reachedThrough, undefined)
  assert.equal(either.reachedThroughCount, undefined)
})

// protects=the default relation refuses an Example that only reaches the library through an installed dependency, so node-script and vite-dev behave as before; fails_when=the default accepts the transitive shape; no_claim=the wording of the sentence
test('the default relation refuses an Example that reaches the library only through a dependency', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  installManifest(fixture, 'mid', { dependencies: { lib: '^2.0.0' } })
  // Act
  const refusal = await refusalOf(check(fixture))
  // Assert
  assert.equal(refusal?.details.reason, 'not-a-dependency')
  assert.equal(refusal?.details.package, 'lib')
  assert.equal(
    refusal?.message,
    "The Example's package.json does not depend on lib.",
  )
})

// protects=direct-or-installed accepts a library that an installed direct dependency lists in its dependencies, and names that dependency; fails_when=the transitive Example is refused or the name is missing; no_claim=version ranges (none are compared)
test('accepts a library listed by an installed direct dependency and names it', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  installManifest(fixture, 'mid', { dependencies: { lib: '^9.9.9' } })
  // Act
  const supported = await check(fixture, 'direct-or-installed')
  // Assert
  assert.deepEqual(supported.reachedThrough, ['mid'])
  assert.equal(supported.reachedThroughCount, 1)
})

// protects=an optional peer dependency counts as a declaration, and a pnpm link is followed to the package's own manifest; fails_when=an optional peer or a linked package is not seen; no_claim=none beyond protects
test('accepts an optional peer declaration found through a link', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  const store = join(
    fixture.examplePackageRoot,
    'node_modules',
    '.store',
    'mid',
  )
  mkdirSync(store, { recursive: true })
  writeFileSync(
    join(store, 'package.json'),
    JSON.stringify({
      name: 'mid',
      version: '1.0.0',
      peerDependencies: { lib: '*' },
      peerDependenciesMeta: { lib: { optional: true } },
    }),
  )
  const linked = join(fixture.examplePackageRoot, 'node_modules', 'mid')
  // The fixture installed a real `mid` folder; replace it by a link like pnpm makes.
  rmSync(linked, { recursive: true, force: true })
  symlinkSync(store, linked, 'dir')
  // Act
  const supported = await check(fixture, 'direct-or-installed')
  // Assert
  assert.deepEqual(supported.reachedThrough, ['mid'])
})

// protects=the list of names stops at 16 sorted names while the count states all of them; fails_when=17 qualifying dependencies list 17 names, an unsorted list or a count of 16; no_claim=none beyond protects
test('lists sixteen sorted names and counts seventeen qualifying dependencies', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  const names = Array.from(
    { length: 17 },
    (_, index) => `dep-${String(16 - index).padStart(2, '0')}`,
  )
  listDependencies(fixture, names)
  for (const name of names)
    installManifest(fixture, name, { dependencies: { lib: '^2.0.0' } })
  // Act
  const supported = await check(fixture, 'direct-or-installed')
  // Assert
  assert.deepEqual(supported.reachedThrough, [
    'dep-00',
    'dep-01',
    'dep-02',
    'dep-03',
    'dep-04',
    'dep-05',
    'dep-06',
    'dep-07',
    'dep-08',
    'dep-09',
    'dep-10',
    'dep-11',
    'dep-12',
    'dep-13',
    'dep-14',
    'dep-15',
  ])
  assert.equal(supported.reachedThroughCount, 17)
})

// protects=neither the Example's package.json nor its installed dependencies naming the library is refused with a sentence that names both checks and the package; fails_when=the sentence names one check only or details.package is missing; no_claim=none beyond protects
test('refuses with a sentence naming both checks when no dependency declares the library', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  // Act
  const refusal = await refusalOf(check(fixture, 'direct-or-installed'))
  // Assert
  assert.equal(refusal?.details.reason, 'not-a-dependency')
  assert.equal(refusal?.details.package, 'lib')
  assert.equal(
    refusal?.message,
    "Neither the Example's package.json nor any of its installed direct dependencies depends on lib.",
  )
})

// protects=a dependency key that is not a plain package name never builds a node_modules path, so a manifest outside node_modules cannot establish the relation; fails_when=listed names reach readInstalledPackageManifest unvalidated; no_claim=symlinks of real package folders (followed on purpose)
test('ignores a listed dependency key that is not a package name', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  listDependencies(fixture, ['../escape'])
  const escaped = join(fixture.examplePackageRoot, 'escape')
  mkdirSync(escaped, { recursive: true })
  writeFileSync(
    join(escaped, 'package.json'),
    JSON.stringify({ name: 'escape', dependencies: { lib: '1.0.0' } }),
  )
  // Act
  const refusal = await refusalOf(check(fixture, 'direct-or-installed'))
  // Assert
  assert.equal(refusal?.details.reason, 'not-a-dependency')
})

// protects=the second validation inside prepareLibraryCore accepts the transitive shape with the option and carries the relation into the facts; fails_when=the core drops the option and refuses a Example the first check accepted; no_claim=a real package manager build (the spawner is a fake)
test('the build core accepts a transitive Example with the option and reports reachedThrough in its facts', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  installManifest(fixture, 'mid', { dependencies: { lib: '^2.0.0' } })
  // Act
  const prepared = await prepareCore(fixture, 'direct-or-installed')
  // Assert
  assert.deepEqual(prepared.facts.reachedThrough, ['mid'])
  assert.equal(prepared.facts.reachedThroughCount, 1)
  await prepared.dispose()
})

// protects=without the option the build core still refuses the transitive shape; fails_when=the core accepts it by default; no_claim=none beyond protects
test('the build core refuses a transitive Example without the option', async () => {
  // Arrange
  const fixture = createLibraryFixture({ exampleDependsOnLibrary: false })
  installManifest(fixture, 'mid', { dependencies: { lib: '^2.0.0' } })
  // Act
  const refusal = await refusalOf(prepareCore(fixture))
  // Assert
  assert.equal(refusal?.details.reason, 'not-a-dependency')
})

// protects=a direct Example's facts carry no reachedThrough, so every other run's facts stay as they were; fails_when=the core adds the keys for a direct listing; no_claim=none beyond protects
test('the build core leaves reachedThrough out of the facts of a direct Example', async () => {
  // Arrange
  const fixture = createLibraryFixture()
  // Act
  const prepared = await prepareCore(fixture, 'direct-or-installed')
  // Assert
  assert.equal('reachedThrough' in prepared.facts, false)
  assert.equal('reachedThroughCount' in prepared.facts, false)
  await prepared.dispose()
})
