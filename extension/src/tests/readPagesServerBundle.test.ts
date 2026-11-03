import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { createBundleVerifier } from '../utils/createBundleVerifier'
import { createNextPagesDiscoveryCache } from '../utils/createNextPagesDiscoveryCache'
import { readPagesServerBundle } from '../utils/readPagesServerBundle'

import { PAGE_SOURCE, nextPagesBuild } from './utils/nextPagesBuildHarness'

// protects=a server stop in a Pages page is sealed from the page's server compile with the layer pages-dir-node and the address of that layer, reading only the compile; fails_when=the module is taken from the browser chunk, carries another layer, or a chunk the compile requires is read although the compile holds the module; no_claim=a real Next server compile (the build is written by the harness in Next 16's layout)
test('a server stop is sealed from the page server compile with the layer pages-dir-node', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild({
    chunks: { 'chunks/shared': { holdsCited: false } },
  })
  const cache = createNextPagesDiscoveryCache()
  // Act
  const result = await readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 5 },
    route: '/',
    cache,
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(result.layer, 'pages-dir-node')
  assert.equal(
    result.bundle.scriptUrl,
    'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx',
  )
  assert.equal(
    result.bundle.chunkPath,
    join(build.workspace, '.next/dev/server/pages/index.js'),
  )
  assert.equal(result.bundle.source, PAGE_SOURCE)
  assert.deepEqual(result.discovery.candidates, ['server/pages/index.js'])
  assert.deepEqual([...cache.chunks.keys()], ['server/pages/index.js'])
  assert.deepEqual(createBundleVerifier(result.bundle).mappedPositions(5, 5), {
    positions: [{ line: 5, column: 1 }],
    complete: true,
  })
})

// protects=a workspace module the page imports, held by a shared server chunk beside the compile, is sealed from that chunk, and the framework-sized vendor chunks are never read; fails_when=the shared chunk is not searched, a vendor-chunks file is read and spends the run's budget, or the chunk is searched before the compile; no_claim=which chunk a real Next build puts a shared module in
test('a module in a server chunk the compile requires is sealed from that chunk and a vendor chunk is not read', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild({
    holdsCited: false,
    chunks: {
      'vendor-chunks/next': { holdsCited: false },
      'chunks/shared': { holdsCited: true },
    },
  })
  const cache = createNextPagesDiscoveryCache()
  // Act
  const result = await readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 5 },
    route: '/',
    cache,
  })
  // Assert
  assert.equal(result.kind, 'sealed')
  assert.equal(result.layer, 'pages-dir-node')
  assert.equal(
    result.bundle.chunkPath,
    join(build.workspace, '.next/dev/server/chunks/shared.js'),
  )
  assert.deepEqual(result.discovery.candidates, [
    'server/pages/index.js',
    'server/chunks/shared.js',
  ])
  assert.equal(cache.chunks.has('server/vendor-chunks/next.js'), false)
})

// protects=a module that neither the page's server compile nor a chunk it requires holds is not sealed, so the run refuses the stop instead of arming a breakpoint in code that never loads; fails_when=the reader seals the module from the browser chunk, throws, or reports it sealed; no_claim=why a real build leaves the module out (a dynamic import)
test('a module neither the server compile nor its chunks hold is not sealed', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild({
    holdsCited: false,
    chunks: { 'chunks/shared': { holdsCited: false } },
  })
  // Act
  const result = await readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 5 },
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(result, {
    kind: 'not-in-server-compile',
    route: '/',
    chunks: ['server/pages/index.js', 'server/chunks/shared.js'],
  })
})

// protects=a route the Pages manifest does not list has no compile to search and is reported as not in the server compile; fails_when=the reader throws, reads a compile of another route, or seals; no_claim=how the route got resolved (resolveNextPagesEntry tests)
test('a route the Pages manifest does not list is not in any server compile', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild()
  // Act
  const result = await readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 5 },
    route: '/missing',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(result, {
    kind: 'not-in-server-compile',
    route: '/missing',
    chunks: [],
  })
})

// protects=a stop in a file that can never be a tracked workspace source (a module under node_modules, which is Next's own code or a dependency) is reported before any file is read; fails_when=the reader reads the build for it or seals the dependency's module; no_claim=that an untracked workspace file is refused (the run's source catalog refuses it before the seal)
test('a stop in a node_modules file is never read or sealed', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild()
  const cache = createNextPagesDiscoveryCache()
  // Act
  const result = await readPagesServerBundle({
    workspace: build.workspace,
    selected: {
      path: 'node_modules/next/dist/server/render.js',
      hash: '0'.repeat(64),
      line: 1,
      column: 1,
    },
    route: '/',
    cache,
  })
  // Assert
  assert.deepEqual(result, { kind: 'not-a-workspace-source' })
  assert.equal(cache.readBytes, 0)
})

// protects=a source that changed since the configuration accepted it is refused with the same error the browser seal gives, not sealed; fails_when=the reader seals bytes whose original differs from the accepted article; no_claim=the wording an agent reads (the run maps it)
test('a source whose bytes differ from the accepted hash is refused', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild()
  // Act
  const sealing = readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, hash: 'f'.repeat(64), line: 5 },
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  await assert.rejects(sealing, {
    message: 'Selected source differs from the accepted article',
  })
})

// protects=two server stops of one run share the run's cache, so the compile is read once and the second stop pays for its source and the Pages manifest only; fails_when=each stop reads the compile again or the budget counts it twice; no_claim=the budget limits themselves (readPagesDevelopmentBundle tests)
test('two server stops in one page read the server compile once in a run', async (context) => {
  // Arrange
  const build = await nextPagesBuild(context)
  await build.writeServerBuild()
  const cache = createNextPagesDiscoveryCache()
  const manifestBytes = (
    await stat(join(build.workspace, '.next/dev/server/pages-manifest.json'))
  ).size
  const compileBytes = (
    await stat(join(build.workspace, '.next/dev/server/pages/index.js'))
  ).size
  // Act
  const first = await readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 5 },
    route: '/',
    cache,
  })
  const second = await readPagesServerBundle({
    workspace: build.workspace,
    selected: { ...build.page, line: 3 },
    route: '/',
    cache,
  })
  // Assert
  assert.equal(first.kind, 'sealed')
  assert.equal(second.kind, 'sealed')
  assert.equal(
    first.discovery.readBytes,
    Buffer.byteLength(PAGE_SOURCE) + manifestBytes + compileBytes,
  )
  assert.equal(
    second.discovery.readBytes,
    Buffer.byteLength(PAGE_SOURCE) + manifestBytes,
  )
  assert.equal(second.bundle.javascript, first.bundle.javascript)
})
