import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_DISCOVERY_LIMIT_BYTES } from '../constants'
import {
  createNextPagesDiscoveryCache,
  type NextPagesChunkModules,
} from '../utils/createNextPagesDiscoveryCache'
import { DiscoveryBudgetError } from '../utils/discoveryBudgetError'
import { readNextServerOnlyReason } from '../utils/readNextServerOnlyReason'
import { readPagesDevelopmentBundle } from '../utils/readPagesDevelopmentBundle'

import {
  PAGE_SOURCE,
  nextPagesBuild,
  pagesEvalModule,
  serverChunk,
} from './utils/nextPagesBuildHarness'

/** Creates an empty temporary workspace that the test removes afterwards. @example await emptyWorkspace(context) */
async function emptyWorkspace(context: TestContext): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-server-only-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  return workspace
}

/**
 * Seals the stand-in page (its browser module maps lines 1–4) and writes the page's server compile, whose `(pages-dir-node)` module maps the given number of lines.
 * @example const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
 */
async function sealedPageWithServerCompile(
  context: TestContext,
  serverMappedLines: number | undefined,
) {
  const build = await nextPagesBuild(context)
  const sealed = await readPagesDevelopmentBundle({
    workspace: build.workspace,
    selected: build.page,
    route: '/',
    cache: createNextPagesDiscoveryCache(),
  })
  assert.equal(sealed.kind, 'sealed')
  if (serverMappedLines !== undefined)
    await build.write(
      '.next/dev/server/pages/index.js',
      serverChunk({
        './src/pages/index.tsx': pagesEvalModule(
          build.workspace,
          'src/pages/index.tsx',
          PAGE_SOURCE,
          'pages-dir-node',
          serverMappedLines,
        ),
      }),
    )
  return { build, clientBundle: sealed.bundle }
}

test('a stop in _document is server-only by Next’s file rule', async (context) => {
  // Arrange
  const workspace = await emptyWorkspace(context)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace,
    path: 'src/pages/_document.tsx',
    line: 4,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'server-only', reason: 'document' })
})

for (const path of ['pages/api/posts/[id].ts', 'pages/api.js'])
  test(`a stop in the API route ${path} is server-only by Next’s file rule`, async (context) => {
    // Arrange
    const workspace = await emptyWorkspace(context)
    // Act
    const reason = await readNextServerOnlyReason({
      workspace,
      path,
      line: 1,
      folder: 'pages',
      compiledPath: 'pages/index.js',
      cache: createNextPagesDiscoveryCache(),
    })
    // Assert
    assert.deepEqual(reason, { kind: 'server-only', reason: 'api-route' })
  })

test('a line the page’s server compile maps and its browser module does not is server-only by evidence', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'server-only', reason: 'server-compile' })
})

test('an unmapped line without a server compile stays unknown, never server-only', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(
    context,
    undefined,
  )
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a line neither the browser module nor the server compile maps stays unknown', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 4)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a line the browser module maps is not server-only, though the server compile maps it too', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 2,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a stop whose browser module was never sealed stays unknown, since a lazily loaded chunk may carry it', async (context) => {
  // Arrange
  const { build } = await sealedPageWithServerCompile(context, 5)
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a server compile built from an older version of the source establishes nothing', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 4)
  await build.write(
    '.next/dev/server/pages/index.js',
    serverChunk({
      './src/pages/index.tsx': pagesEvalModule(
        build.workspace,
        'src/pages/index.tsx',
        `${PAGE_SOURCE}// older\n`,
        'pages-dir-node',
        5,
      ),
    }),
  )
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('a server compile that cannot be read establishes nothing instead of failing the run', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(
    context,
    undefined,
  )
  // A directory where the server compile should be makes its read fail, as a file replaced by `next dev` mid-read would.
  await mkdir(join(build.workspace, '.next/dev/server/pages/index.js'), {
    recursive: true,
  })
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

test('an aborted run still rejects while the server compile is read', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  const controller = new AbortController()
  controller.abort()
  // Act
  const outcome = readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    signal: controller.signal,
    cache: createNextPagesDiscoveryCache(),
  })
  // Assert
  await assert.rejects(outcome, { name: 'AbortError' })
})

/** A run's chunk map whose lookup fails with an unrelated error that only carries the discovery budget's words, as a failure of any other read could. */
class BudgetWordedChunkLookup extends Map<string, NextPagesChunkModules> {
  override get(): NextPagesChunkModules | undefined {
    throw new Error('Build discovery resource limit exceeded')
  }
}

// Value: protects=only the run's own discovery budget ends the run from a server compile read, told by its type; fails_when=an unrelated error whose message reads like the budget is taken as budget exhaustion and ends the run; why_new=Cycle 0066 task 1 (typed discovery-budget marker); seam=a chunk map whose lookup throws; no_claim=which reads can throw that message in practice
test('an unrelated server compile failure that carries the budget’s words establishes nothing instead of ending the run', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  const cache = {
    readBytes: 0,
    spentMs: 0,
    chunks: new BudgetWordedChunkLookup(),
  }
  // Act
  const reason = await readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache,
  })
  // Assert
  assert.deepEqual(reason, { kind: 'unknown' })
})

// Value: protects=a server compile larger than what the run's discovery budget has left still ends the run as budget exhaustion; fails_when=the budget refusal of the shared discovery step is not the typed marker and is swallowed as an unreadable compile; why_new=Cycle 0066 task 1 (typed discovery-budget marker); seam=the run's cache with all but 64 bytes spent; no_claim=the time budget
test('a server compile larger than the run’s remaining discovery bytes ends the run with the budget refusal', async (context) => {
  // Arrange
  const { build, clientBundle } = await sealedPageWithServerCompile(context, 5)
  const cache = createNextPagesDiscoveryCache()
  // As if the run's earlier stops had read all but 64 bytes of the budget.
  cache.readBytes = REPOSITORY_DISCOVERY_LIMIT_BYTES - 64
  // Act
  const outcome = readNextServerOnlyReason({
    workspace: build.workspace,
    path: 'src/pages/index.tsx',
    line: 5,
    folder: 'src/pages',
    compiledPath: 'pages/index.js',
    clientBundle,
    cache,
  })
  // Assert
  await assert.rejects(outcome, (error) => {
    assert.ok(error instanceof DiscoveryBudgetError)
    assert.equal(error.message, 'Build discovery resource limit exceeded')
    return true
  })
})
