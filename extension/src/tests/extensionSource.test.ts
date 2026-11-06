import assert from 'node:assert/strict'
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import {
  prepareExtensionSource,
  type ExtensionStopEnvironment,
} from '../extensionSource'
import { buildWxtExtension } from '../utils/buildWxtExtension'
import { readExtensionManifest } from '../utils/readExtensionManifest'

import {
  baselineExtensionFiles,
  createRepositoryFixture,
  parsedBaseline,
} from './utils/chromeExtensionFixture'
import {
  BACKGROUND_SOURCE,
  OPTIONS_APP_SOURCE,
  createSuccessfulBuildSpawner,
  createWxtFixture,
  writeWxtBuild,
  wxtConfiguration,
} from './utils/wxtSourceFixture'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const NODE_24 = { executable: '/usr/local/bin/node', version: '24.1.0' }

/** The environment a resolver would hand a source after reading the load root's manifest. */
async function environmentOf(
  loadRoot: string,
  surfaceHtml: string,
): Promise<ExtensionStopEnvironment> {
  return {
    extensionId: EXTENSION_ID,
    manifest: await readExtensionManifest(loadRoot),
    surfaceHtml,
  }
}

/** Writes the fixture build and returns a fake build step that reports it as built in 1,234 ms. */
async function builtFixture(context: TestContext) {
  const fixture = await createWxtFixture(context)
  const loadRoot = join(fixture.buildFolder, 'chrome-mv3-dev')
  await writeWxtBuild(loadRoot, fixture.projectRoot)
  const buildExtension = async () => ({
    kind: 'built' as const,
    loadRoot,
    wxtVersion: '0.21.4',
    durationMs: 1_234,
  })
  return { ...fixture, loadRoot, buildExtension }
}

// protects=an unpacked run keeps one folder as its project and load root and no build fact, which is what keeps every unpacked run and history unchanged; fails_when=the roots differ or a build fact appears; no_claim=anything about a WXT project
test('an unpacked extension has the same project and load root and no build', async (context) => {
  // Arrange
  const repositoryRoot = await createRepositoryFixture(
    context,
    baselineExtensionFiles(),
  )
  // Act
  const source = await prepareExtensionSource({
    repositoryRoot,
    configuration: parsedBaseline(),
  })
  // Assert
  assert.equal(source.adapter, 'chrome-mv3-unpacked')
  assert.equal(source.projectRoot, join(repositoryRoot, 'ext'))
  assert.equal(source.loadRoot, join(repositoryRoot, 'ext'))
  assert.equal(source.build, undefined)
})

// protects=an unpacked stop is pinned with the file's own bytes hash when a statically loaded file holds it; fails_when=the stop is refused or the hash or path differs; no_claim=the inline-script and bundled rules (the resolver tests keep them)
test('an unpacked stop in a statically loaded file resolves with the file hash', async (context) => {
  // Arrange
  const repositoryRoot = await createRepositoryFixture(
    context,
    baselineExtensionFiles(),
  )
  const configuration = parsedBaseline()
  const source = await prepareExtensionSource({ repositoryRoot, configuration })
  const environment = await environmentOf(
    source.loadRoot,
    join(source.loadRoot, 'popup/popup.html'),
  )
  // Act
  const stop = await source.resolveStop(configuration.stops[0]!, 0, environment)
  // Assert
  assert.deepEqual(stop, {
    index: 1,
    path: 'popup/popup.js',
    absolutePath: join(repositoryRoot, 'ext/popup/popup.js'),
    line: 2,
    context: 'page',
    sha256: 'c8a803d31e97738f6220aecce820bfab876ec32c0f02271b6c104cb6c6f180f5',
  })
})

// protects=an unpacked stop in a file the page never loads is refused as STOP_FILE_NOT_LOADED; fails_when=a file outside the static loads is accepted; no_claim=the wording of the sentence
test('an unpacked stop in a file the page does not load is refused', async (context) => {
  // Arrange
  const repositoryRoot = await createRepositoryFixture(
    context,
    baselineExtensionFiles(),
  )
  const configuration = parsedBaseline({
    stops: [{ path: 'background/lib.js', line: 2, context: 'page' }],
  })
  const source = await prepareExtensionSource({ repositoryRoot, configuration })
  const environment = await environmentOf(
    source.loadRoot,
    join(source.loadRoot, 'popup/popup.html'),
  )
  // Act
  const refusal = source.resolveStop(configuration.stops[0]!, 0, environment)
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'STOP_FILE_NOT_LOADED')
    return true
  })
})

// protects=a built WXT project is three roots (repository, project, build output) with the build facts, so the manifest is read from the build while stops stay in the project; fails_when=the load root is the project or the facts are lost; no_claim=that WXT built it (the build step is a fake here)
test('a wxt-build source separates the repository, project and load roots and carries the build facts', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  // Act
  const source = await prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration: wxtConfiguration(),
    privateFolder: built.buildFolder,
    buildExtension: built.buildExtension,
  })
  // Assert
  assert.equal(source.adapter, 'wxt-build')
  assert.equal(source.repositoryRoot, built.repositoryRoot)
  assert.equal(source.projectRoot, built.projectRoot)
  assert.equal(source.loadRoot, built.loadRoot)
  assert.deepEqual(source.build, {
    tool: 'wxt',
    version: '0.21.4',
    durationMs: 1_234,
  })
})

// protects=a wxt-build page stop resolves to the project source with its repository-relative path, the file hash and the executed text from the map; fails_when=the path is a build path, the hash is not the file's or the text is missing; no_claim=that the editor binds a breakpoint there
test('a wxt-build page stop resolves to the project source with the executed text', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  const configuration = wxtConfiguration()
  const source = await prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration,
    privateFolder: built.buildFolder,
    buildExtension: built.buildExtension,
  })
  const environment = await environmentOf(
    source.loadRoot,
    join(source.loadRoot, 'options.html'),
  )
  // Act
  const stop = await source.resolveStop(configuration.stops[0]!, 0, environment)
  // Assert
  assert.equal(stop.path, 'ext/src/entrypoints/options/App.ts')
  assert.equal(
    stop.absolutePath,
    join(built.projectRoot, 'src/entrypoints/options/App.ts'),
  )
  assert.equal(stop.executedText, OPTIONS_APP_SOURCE)
  assert.equal(
    stop.sha256,
    'b77ad3ab755acc74ca0c55ef558ea4186622d4fe692cfd7bb0f6d346f57136af',
  )
})

// protects=a wxt-build worker stop resolves through the worker's own map; fails_when=the worker context reads the page's maps; no_claim=that the worker starts
test('a wxt-build service-worker stop resolves through the worker chunk map', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  const configuration = wxtConfiguration()
  const source = await prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration,
    privateFolder: built.buildFolder,
    buildExtension: built.buildExtension,
  })
  const environment = await environmentOf(
    source.loadRoot,
    join(source.loadRoot, 'options.html'),
  )
  // Act
  const stop = await source.resolveStop(configuration.stops[1]!, 1, environment)
  // Assert
  assert.equal(stop.context, 'service-worker')
  assert.equal(stop.executedText, BACKGROUND_SOURCE)
})

// protects=a wxt-build stop in a project file no loaded chunk lists is refused with the sources the context does list, so the chat can correct the path; fails_when=the refusal lacks contextSources or lists the worker's sources for the page; no_claim=the sentence wording
test('a wxt-build stop in an unlisted file is refused with the sources the context lists', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  const configuration = wxtConfiguration({
    stops: [
      { path: 'src/entrypoints/background.ts', line: 1, context: 'page' },
    ],
  })
  const source = await prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration,
    privateFolder: built.buildFolder,
    buildExtension: built.buildExtension,
  })
  const environment = await environmentOf(
    source.loadRoot,
    join(source.loadRoot, 'options.html'),
  )
  // Act
  const refusal = source.resolveStop(configuration.stops[0]!, 0, environment)
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'STOP_FILE_NOT_LOADED')
    assert.deepEqual(error.details, {
      reason: 'not-listed',
      contextSources: ['src/entrypoints/options/App.ts', 'src/lib/other.ts'],
      contextSourceCount: 2,
    })
    return true
  })
})

// protects=a stop that leaves the project folder by name is refused as stop-outside-project before the build is called; fails_when=the build starts for it; no_claim=a stop reaching outside through a link (the maps only list project sources)
test('a wxt-build stop outside the project is refused before any build', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  let buildCalls = 0
  const configuration = wxtConfiguration({
    stops: [{ path: '../elsewhere/a.ts', line: 1, context: 'page' }],
  })
  // Act
  const refusal = prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration,
    privateFolder: built.buildFolder,
    buildExtension: async () => {
      buildCalls += 1
      return built.buildExtension()
    },
  })
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'EXTENSION_BUILD_UNSUPPORTED')
    assert.deepEqual(error.details, {
      reason: 'stop-outside-project',
      field: 'configuration.stops[0].path',
    })
    return true
  })
  assert.equal(buildCalls, 0)
})

// protects=two stops at the same place are refused before the build starts; fails_when=a duplicate costs a build; no_claim=the resolved-path duplicate (the resolver keeps it)
test('duplicate stops are refused before any build', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  let buildCalls = 0
  const stop = {
    path: 'src/entrypoints/options/App.ts',
    line: 2,
    context: 'page',
  }
  // Act
  const refusal = prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration: wxtConfiguration({ stops: [stop, stop] }),
    privateFolder: built.buildFolder,
    buildExtension: async () => {
      buildCalls += 1
      return built.buildExtension()
    },
  })
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'STOP_DUPLICATE')
    return true
  })
  assert.equal(buildCalls, 0)
})

// protects=a build ended by the run's own stop becomes today's stop error, not a build failure; fails_when=a cancelled build is reported as EXTENSION_BUILD_FAILED or resolves; no_claim=tracked-file comparison (the build step's own tests)
test('a cancelled build ends with the stop-before-ready error', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  // Act
  const refusal = prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration: wxtConfiguration(),
    privateFolder: built.buildFolder,
    buildExtension: async () => ({ kind: 'cancelled' }),
  })
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'RUNTIME_FAILED')
    assert.equal(
      error.message,
      'The extension run was stopped before it was ready.',
    )
    return true
  })
})

// protects=the build phase is announced with the WXT version resolved from the project before the build starts; fails_when=the callback is skipped, late or told another version; no_claim=the status bar text
test('the build phase is announced with the project WXT version before the build', async (context) => {
  // Arrange
  const built = await builtFixture(context)
  const events: string[] = []
  // Act
  await prepareExtensionSource({
    repositoryRoot: built.repositoryRoot,
    configuration: wxtConfiguration(),
    privateFolder: built.buildFolder,
    onBuilding: (version) => events.push(`building ${version}`),
    buildExtension: async () => {
      events.push('build')
      return built.buildExtension()
    },
  })
  // Assert
  assert.deepEqual(events, ['building 0.21.4', 'build'])
})

// protects=a private folder reached through a link still yields stops that resolve, because the build is told the folder's real path and Vite's relative map sources then resolve; fails_when=the sources resolve to a path that does not exist and every stop reads not-listed; no_claim=real WXT or Vite (the spawner writes maps the way Vite spells them for the folder it was told)
test('a wxt-build stop still resolves when the private folder is reached through a link', async (context) => {
  // Arrange
  const fixture = await createWxtFixture(context)
  const linkParent = join(fixture.buildFolder, 'a', 'b')
  await mkdir(linkParent, { recursive: true })
  const realPrivateFolder = join(fixture.buildFolder, 'real-private')
  await mkdir(realPrivateFolder)
  const linkedPrivateFolder = join(linkParent, 'link')
  await symlink(realPrivateFolder, linkedPrivateFolder)
  const configuration = wxtConfiguration()
  // Act
  const source = await prepareExtensionSource({
    repositoryRoot: fixture.repositoryRoot,
    configuration,
    privateFolder: linkedPrivateFolder,
    node: NODE_24,
    buildExtension: (input) =>
      buildWxtExtension({
        ...input,
        spawner: createSuccessfulBuildSpawner(fixture.projectRoot),
      }),
  })
  const environment = await environmentOf(
    source.loadRoot,
    join(source.loadRoot, 'options.html'),
  )
  const stop = await source.resolveStop(configuration.stops[0]!, 0, environment)
  // Assert
  assert.equal(
    source.loadRoot,
    join(realPrivateFolder, 'wxt-build', 'chrome-mv3-dev'),
  )
  assert.equal(stop.path, 'ext/src/entrypoints/options/App.ts')
})
