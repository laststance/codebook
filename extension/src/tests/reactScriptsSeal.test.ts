import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_MAP_LIMIT_BYTES } from '../constants'
import { StudyError } from '../errors'
import { ReactScriptsBundleCache } from '../utils/readReactScriptsServedBundle'
import { sealReactScriptsStop } from '../utils/sealReactScriptsStop'

import {
  createReactScriptsRepository,
  serveFakeBundle,
  type ReactScriptsRepository,
  type ServedMapOptions,
} from './utils/reactScriptsFixture'

const APP_FOLDER = 'examples/counter'

/** Seals the stop in `src/App.js` of a staged app against a served map. */
async function seal(
  context: TestContext,
  repository: ReactScriptsRepository,
  map: (stopPath: string) => ServedMapOptions,
  options: {
    line?: number
    citationEndLine?: number
    appRoot?: string
    packageRelativePath?: string
    path?: string
    cache?: ReactScriptsBundleCache
  } = {},
) {
  const stopPath = join(repository.appRoot, 'src/App.js')
  const served = await serveFakeBundle(context, () => map(stopPath))
  const cache = options.cache ?? new ReactScriptsBundleCache()
  const sealing = () =>
    sealReactScriptsStop({
      appRoot: options.appRoot ?? repository.appRoot,
      packageRootRelative: APP_FOLDER,
      packageRelativePath: options.packageRelativePath ?? 'src/App.js',
      source: {
        path: options.path ?? `${APP_FOLDER}/src/App.js`,
        hash: repository.sourceHash,
        line: options.line ?? 2,
        column: 1,
      },
      citationEndLine: options.citationEndLine ?? 3,
      ownedOrigin: served.origin,
      signal: new AbortController().signal,
      cache,
    })
  return { sealing, served, cache, stopPath }
}

/** Reads the refusal a seal ended with: code and reason. */
async function refusalOf(
  sealing: () => Promise<unknown>,
): Promise<{ code: string; reason: unknown }> {
  const error = await sealing().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return { code: error.code, reason: error.details?.reason }
}

// Value: protects=a stop in the app's own file is sealed from the served bundle with the file's text kept and the bundle unchanged; fails_when=the stop file is not found in the map by its canonical path or the sealed bundle is altered; no_claim=a real react-scripts bundle or a real browser pause
test('a stop in the apps own file is sealed from the served bundle and its map', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing, served } = await seal(context, repository, (stopPath) => ({
    sources: [stopPath, 'webpack/runtime/global'],
    sourcesContent: [repository.sourceText, null],
  }))
  // Act
  const { bundle } = await sealing()
  // Assert
  assert.equal(bundle.scriptUrl, `${served.origin}/static/js/bundle.js`)
  assert.equal(bundle.source, repository.sourceText)
  assert.equal(bundle.sourcePath, join(repository.appRoot, 'src/App.js'))
  assert.match(bundle.javascript, /^console\.log\(0\)/)
})

// Value: protects=a symlinked app folder still seals because the map names the real path (E3); fails_when=the seal compares the configured link path with the map's real path and refuses a valid stop; no_claim=Windows junctions
test('a symlinked app root still seals against the real path the map names', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const linkedRoot = join(repository.root, 'linked-counter')
  await symlink(repository.appRoot, linkedRoot, 'dir')
  const { sealing } = await seal(
    context,
    repository,
    (stopPath) => ({
      sources: [stopPath],
      sourcesContent: [repository.sourceText],
    }),
    { appRoot: linkedRoot },
  )
  // Act
  const { bundle } = await sealing()
  // Assert
  assert.equal(bundle.sourcePath, join(repository.appRoot, 'src/App.js'))
})

// Value: protects=a stop file in node_modules is refused as a published package; fails_when=a node_modules file is sealed as the checked-out library; no_claim=a library outside the app
test('a stop in node_modules is refused with node-modules', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  await repository.write('node_modules/lib/index.js', 'x')
  const { sealing } = await seal(context, repository, () => ({}), {
    packageRelativePath: 'node_modules/lib/index.js',
    path: `${APP_FOLDER}/node_modules/lib/index.js`,
  })
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'node-modules',
  })
})

// Value: protects=a map that does not name the stop file by the app's canonical path is refused as outside-package; fails_when=a stop is sealed from a map of another folder; no_claim=a path outside the repository (refused earlier at configuration)
test('a map that names the stop file under another folder is refused with outside-package', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing } = await seal(context, repository, () => ({
    sources: ['/somewhere/else/src/App.js'],
    sourcesContent: [repository.sourceText],
  }))
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'outside-package',
  })
})

// Value: protects=a file edited after the dev server compiled it ends in SOURCE_CHANGED, never a seal of other text; fails_when=the map's retained text is not compared with the checked-out file; no_claim=an edit made while the run is paused
test('a file whose compiled text differs from the checked-out file is refused with SOURCE_CHANGED', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing } = await seal(context, repository, (stopPath) => ({
    sources: [stopPath],
    sourcesContent: ['export function App() {}\n'],
  }))
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.equal(refusal.code, 'SOURCE_CHANGED')
})

// Value: protects=a declared line that no mapping reaches is refused with unmapped-line; fails_when=an unmapped line is sealed and fails later at the pause; no_claim=lines the browser cannot bind
test('a stop line no mapped position reaches is refused with unmapped-line', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing } = await seal(
    context,
    repository,
    (stopPath) => ({
      sources: [stopPath],
      sourcesContent: [repository.sourceText],
    }),
    { line: 5, citationEndLine: 6 },
  )
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'unmapped-line',
  })
})

// Value: protects=a map over the byte limit is refused with map-limit; fails_when=an oversized map is read whole or fails with an uncoded error; no_claim=the three mapped-position scan limits (named by the refusal builder test)
test('a map over the byte limit is refused with map-limit', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing } = await seal(context, repository, (stopPath) => ({
    sources: [stopPath],
    sourcesContent: [repository.sourceText],
    padToBytes: REPOSITORY_MAP_LIMIT_BYTES + 1,
  }))
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'map-limit',
  })
})

// Value: protects=a map whose walk stops at a scan limit is refused with map-limit instead of unmapped-line; fails_when=an incomplete scan is read as an unmapped line; no_claim=real bundles near the limit
test('a map whose scan stops at a limit is refused with map-limit, not unmapped-line', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing } = await seal(context, repository, (stopPath) => ({
    sources: [stopPath],
    sourcesContent: [repository.sourceText],
    mappings: ';'.repeat(100_002),
  }))
  // Act
  const refusal = await refusalOf(sealing)
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'map-limit',
  })
})

// Value: protects=one map read serves every stop of a compile and a recompile reads a new map (E5); fails_when=each stop downloads the map again, or a changed bundle keeps the old map; no_claim=the bundle itself is fetched per seal
test('two stops read the map once and a recompile reads it again', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { sealing, served } = await seal(context, repository, (stopPath) => ({
    sources: [stopPath],
    sourcesContent: [repository.sourceText],
  }))
  // Act
  await sealing()
  await sealing()
  const mapReadsBeforeRecompile = served.counts.map
  served.recompile()
  await sealing()
  // Assert
  assert.equal(mapReadsBeforeRecompile, 1)
  assert.equal(served.counts.map, 2)
})
