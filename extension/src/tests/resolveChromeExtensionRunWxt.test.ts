import assert from 'node:assert/strict'
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { prepareExtensionSource } from '../extensionSource'
import { resolveChromeExtensionRun } from '../resolveChromeExtensionRun'
import { chromeExtensionIdFromPath } from '../utils/chromeExtensionId'

import {
  createWxtFixture,
  writeWxtBuild,
  wxtConfiguration,
} from './utils/wxtSourceFixture'

/** Builds the fixture (written by hand, not by WXT) and prepares a source whose build step reports it. */
async function sourceOf(
  context: TestContext,
  configuration = wxtConfiguration(),
) {
  const fixture = await createWxtFixture(context)
  const loadRoot = join(fixture.buildFolder, 'chrome-mv3-dev')
  await writeWxtBuild(loadRoot, fixture.projectRoot)
  const source = await prepareExtensionSource({
    repositoryRoot: fixture.repositoryRoot,
    configuration,
    privateFolder: fixture.buildFolder,
    buildExtension: async () => ({
      kind: 'built',
      loadRoot,
      wxtVersion: '0.21.4',
      durationMs: 2_000,
    }),
  })
  return { ...fixture, loadRoot, source, configuration }
}

// protects=a wxt-build run reads the manifest and the surface from the build folder and gives the id of the build's path, while the stops stay in the project and the repository stays the identity root; fails_when=the project folder is read for the manifest, the id comes from another path, or a stop is a build path; no_claim=that Chrome loads the build
test('a wxt-build run resolves the manifest from the build and the stops in the project', async (context) => {
  // Arrange
  const { repositoryRoot, projectRoot, loadRoot, source, configuration } =
    await sourceOf(context)
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration,
    source,
  })
  // Assert
  assert.equal(run.root, loadRoot)
  assert.equal(run.extensionId, chromeExtensionIdFromPath(loadRoot))
  assert.equal(run.manifestName, 'Wxt Fixture')
  assert.deepEqual(run.surface, { kind: 'page', path: 'options.html' })
  assert.deepEqual(run.build, {
    tool: 'wxt',
    version: '0.21.4',
    durationMs: 2_000,
  })
  assert.deepEqual(
    run.stops.map((stop) => [stop.path, stop.absolutePath, stop.context]),
    [
      [
        'ext/src/entrypoints/options/App.ts',
        join(projectRoot, 'src/entrypoints/options/App.ts'),
        'page',
      ],
      [
        'ext/src/entrypoints/background.ts',
        join(projectRoot, 'src/entrypoints/background.ts'),
        'service-worker',
      ],
    ],
  )
})

// protects=the pinned hashes of a wxt-build run name the build's manifest and surface and the project's stop sources, so the source check watches the files the learner edits; fails_when=a stop is pinned under a build path or the manifest under the project; no_claim=the hash values of the fixture (the unpacked test pins those)
test('a wxt-build run pins the build manifest and the project stop sources', async (context) => {
  // Arrange
  const { repositoryRoot, projectRoot, loadRoot, source, configuration } =
    await sourceOf(context)
  // Act
  const run = await resolveChromeExtensionRun({
    repositoryRoot,
    configuration,
    source,
  })
  // Assert
  assert.deepEqual(Object.keys(run.pinnedHashes).sort(), [
    join(loadRoot, 'manifest.json'),
    join(loadRoot, 'options.html'),
    join(projectRoot, 'src/entrypoints/background.ts'),
    join(projectRoot, 'src/entrypoints/options/App.ts'),
  ])
})

// protects=a wxt-build stop no loaded chunk lists is refused through the resolver with the sources its context lists in details.contextSources; fails_when=the resolver swallows the details or checks the static loads of the project; no_claim=the sentence wording
test('a wxt-build stop in an unlisted source is refused with the listed sources', async (context) => {
  // Arrange
  const configuration = wxtConfiguration({
    stops: [{ path: 'src/lib/other.ts', line: 1, context: 'service-worker' }],
  })
  const { repositoryRoot, source } = await sourceOf(context, configuration)
  // Act
  const refusal = resolveChromeExtensionRun({
    repositoryRoot,
    configuration,
    source,
  })
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'STOP_FILE_NOT_LOADED')
    assert.deepEqual(error.details?.contextSources, [
      'src/entrypoints/background.ts',
    ])
    return true
  })
})

// protects=a link inside the build folder that leaves it is refused, so Chrome never serves a file from outside the build; fails_when=the link walk is skipped or confined to the repository for a wxt-build run; no_claim=links inside the project (the build folder is the only folder Chrome serves)
test('a wxt-build run refuses a link in the build folder that leaves it', async (context) => {
  // Arrange
  const { repositoryRoot, loadRoot, source, configuration } =
    await sourceOf(context)
  await mkdir(join(repositoryRoot, 'outside'))
  await symlink(join(repositoryRoot, 'outside'), join(loadRoot, 'leak'))
  // Act
  const refusal = resolveChromeExtensionRun({
    repositoryRoot,
    configuration,
    source,
  })
  // Assert
  await assert.rejects(refusal, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'EXTENSION_LINK_OUTSIDE')
    return true
  })
})
